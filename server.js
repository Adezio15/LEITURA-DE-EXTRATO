import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import PDFDocument from 'pdfkit';
import pdfParse from 'pdf-parse';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { authenticateUser, createUser, findUserById, initializeDatabase } from './database.js';

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-only-change-this-secret';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');
const MAX_FILE_SIZE_MB = 80;
const MONEY_PATTERN_SOURCE = '[+-]?(?:\\d[\\d.\\s]*[,\\.]\\d{2})';
const MONEY_WITH_TYPE_PATTERN = new RegExp(
  `(?:R\\$\\s*)?(${MONEY_PATTERN_SOURCE})\\s*([DC])\\b|\\b([DC])\\b\\s*(?:R\\$\\s*)?(${MONEY_PATTERN_SOURCE})`,
  'gi'
);
const MONEY_ONLY_PATTERN = new RegExp(`(?:R\\$\\s*)?(${MONEY_PATTERN_SOURCE})\\s*$`, 'i');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET deve ser configurada no ambiente de producao.');
}

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      path.extname(file.originalname).toLowerCase() === '.pdf';

    if (!isPdf) {
      cb(new Error('Envie somente arquivos PDF.'));
      return;
    }

    cb(null, true);
  }
});

app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(express.static(publicDir, { index: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim().split('='))
    .reduce((cookies, [key, ...value]) => {
      if (key) cookies[key] = decodeURIComponent(value.join('='));
      return cookies;
    }, {});
}

function signSession(userId) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function readSession(req) {
  const token = parseCookies(req).session;
  const [userId, expiresAt, signature] = String(token || '').split('.');
  if (!userId || !expiresAt || !signature || Number(expiresAt) < Date.now()) return null;

  const payload = `${userId}.${expiresAt}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return null;
  }
  return userId;
}

function setSessionCookie(res, userId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `session=${encodeURIComponent(signSession(userId))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function requireAuth(req, res, next) {
  const userId = readSession(req);
  if (!userId) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sessao expirada. Entre novamente.' });
    return res.redirect('/login');
  }
  req.userId = userId;
  next();
}

app.get('/login', (req, res) => {
  if (readSession(req)) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/cadastro', (req, res) => {
  if (readSession(req)) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'cadastro.html'));
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.post('/api/auth/cadastro', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const passwordConfirmation = String(req.body.passwordConfirmation || '');

    if (!name || !email || !password || !passwordConfirmation) {
      return res.status(400).json({ error: 'Preencha todos os campos.' });
    }
    if (name.length > 120) {
      return res.status(400).json({ error: 'O nome deve ter no maximo 120 caracteres.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Informe um e-mail valido.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'A senha deve ter no maximo 128 caracteres.' });
    }
    if (password !== passwordConfirmation) {
      return res.status(400).json({ error: 'As senhas nao conferem.' });
    }

    const user = await createUser({ name, email, password });
    return res.status(201).json({ user });
  } catch (error) {
    if (error.code === '23505' || String(error.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Este e-mail ja esta cadastrado.' });
    }
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });

    const user = await authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'E-mail ou senha invalidos.' });

    setSessionCookie(res, user.id);
    return res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Usuario nao encontrado.' });
    }
    return res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

function normalizeSpaces(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeDescriptionLine(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function parseBrazilianMoney(value) {
  const normalizedValue = normalizeMoneyText(value);
  const numeric = String(normalizedValue || '')
    .replace(/[^\d,.\-+]/g, '')
    .replace(/[.\s](?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  return Number.parseFloat(numeric);
}

function normalizeMoneyText(value) {
  const cleanValue = String(value || '')
    .replace(/[^\d,.\-+\s]/g, '')
    .replace(/\s+/g, '');

  const parts = cleanValue.split(',');
  const integerPart = parts[0].replace(/[^\d\-+]/g, '');
  const decimalPart = (parts[1] || '00').replace(/\D/g, '').padEnd(2, '0').slice(0, 2);
  const sign = integerPart.startsWith('-') ? '-' : '';
  const digits = integerPart.replace(/[^\d]/g, '');
  const formattedInteger = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${sign}${formattedInteger || '0'},${decimalPart}`;
}

function formatBrazilianMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function cleanDescription(description) {
  return String(description || '')
    .split('\n')
    .map(normalizeDescriptionLine)
    .filter(Boolean)
    .join('\n');
}

function hasTransactionValue(line) {
  return Boolean(getTransactionValueMatch(line));
}

function isIgnoredStatementLine(line) {
  return /^(data|historico|histórico|descricao|descrição|documento|valor|saldo|ag[eê]ncia|conta)\b/i.test(
    normalizeDescriptionLine(line)
  );
}

function getTransactionValueMatch(line) {
  MONEY_WITH_TYPE_PATTERN.lastIndex = 0;
  const matches = [...String(line || '').matchAll(MONEY_WITH_TYPE_PATTERN)];

  if (!matches.length) {
    return null;
  }

  const match = matches[matches.length - 1];
  const value = match[1] || match[4];
  const type = match[2] || match[3];

  return {
    0: match[0],
    1: value,
    2: type,
    index: match.index
  };
}

function getAmountOnlyMatch(line) {
  const match = String(line || '').match(MONEY_ONLY_PATTERN);
  return match
    ? {
        0: match[0],
        1: match[1],
        index: match.index
      }
    : null;
}

function isTransactionTypeOnly(line) {
  return /^[DC]$/i.test(normalizeDescriptionLine(line));
}

function getLineDate(line) {
  const datePattern = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;
  const dateMatch = String(line || '').match(datePattern);
  return dateMatch ? dateMatch[1] : '';
}

function startsWithLineDate(line) {
  return /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(String(line || '').trim());
}

function removeDate(text) {
  return String(text || '').replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/, '');
}

function getDescriptionBeforeValue(line) {
  const valueMatch = getTransactionValueMatch(line);

  if (!valueMatch) {
    return '';
  }

  const valor = valueMatch[1];
  const valueIndex = valueMatch.index ?? String(line).lastIndexOf(valor);
  return normalizeDescriptionLine(removeDate(String(line).slice(0, valueIndex)));
}

function extractEntryFromLines(lines) {
  let usefulLines = lines.map(normalizeDescriptionLine).filter(Boolean);
  const valueLineIndex = usefulLines.findIndex((line) => hasTransactionValue(line));
  const amountOnlyLineIndex = usefulLines.findIndex((line, index) => {
    const nextLine = usefulLines[index + 1];
    return getAmountOnlyMatch(line) && isTransactionTypeOnly(nextLine);
  });
  const valueBoundaryIndex =
    valueLineIndex >= 0 ? valueLineIndex : amountOnlyLineIndex >= 0 ? amountOnlyLineIndex : usefulLines.length - 1;
  let lastDateIndex = -1;

  for (let index = valueBoundaryIndex; index >= 0; index -= 1) {
    if (getLineDate(usefulLines[index])) {
      lastDateIndex = index;
      break;
    }
  }

  if (lastDateIndex > 0) {
    usefulLines = usefulLines.slice(lastDateIndex);
  }

  const trimmedValueLineIndex = usefulLines.findIndex((line) => hasTransactionValue(line));
  let valueLine = usefulLines[trimmedValueLineIndex] || '';
  let valueMatch = getTransactionValueMatch(valueLine);
  let amountOnlyIndex = -1;

  if (!valueMatch) {
    amountOnlyIndex = usefulLines.findIndex((line, index) => {
      const nextLine = usefulLines[index + 1];
      return getAmountOnlyMatch(line) && isTransactionTypeOnly(nextLine);
    });

    if (amountOnlyIndex >= 0) {
      const amountMatch = getAmountOnlyMatch(usefulLines[amountOnlyIndex]);
      const typeLine = usefulLines[amountOnlyIndex + 1];
      valueLine = usefulLines[amountOnlyIndex];
      valueMatch = {
        0: amountMatch[0],
        1: amountMatch[1],
        2: typeLine.toUpperCase(),
        index: amountMatch.index
      };
    }
  }

  if (!valueMatch) {
    return null;
  }

  const tipo = valueMatch[2].toUpperCase();
  const valor = normalizeMoneyText(valueMatch[1]);
  const valueIndex = valueMatch.index ?? valueLine.lastIndexOf(valor);
  const data = usefulLines.map(getLineDate).find(Boolean) || '';
  const descriptionEndIndex = amountOnlyIndex >= 0 ? amountOnlyIndex + 1 : trimmedValueLineIndex + 1;
  const descriptionLines = usefulLines
    .slice(0, descriptionEndIndex)
    .filter((line) => !isIgnoredStatementLine(line))
    .map((line, index) => {
      const text =
        line === valueLine || index === descriptionEndIndex - 1
          ? line.slice(0, valueIndex)
          : line;
      return removeDate(text);
    });
  const descricao = cleanDescription(descriptionLines.join('\n'));

  return {
    data,
    descricao: descricao || 'Lancamento sem descricao',
    valor,
    valorNumero: parseBrazilianMoney(valor),
    tipo
  };
}

function extractEntryFromLine(line) {
  return extractEntryFromLines([line]);
}

function extractEntries(pdfText) {
  const text = String(pdfText || '').replace(/\r/g, '\n');
  const rawLines = text
    .split('\n')
    .map(normalizeSpaces)
    .filter(Boolean);

  const entries = [];
  let pendingLines = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];

    if (isIgnoredStatementLine(line)) {
      pendingLines = [];
      continue;
    }

    if (startsWithLineDate(line) && pendingLines.length && !hasTransactionValue(pendingLines[pendingLines.length - 1])) {
      pendingLines = [];
    }

    pendingLines.push(line);

    if (!hasTransactionValue(line)) {
      const nextLine = rawLines[index + 1];
      if (getAmountOnlyMatch(line) && isTransactionTypeOnly(nextLine)) {
        pendingLines.push(nextLine);
        const entry = extractEntryFromLines(pendingLines);

        if (entry) {
          entries.push(entry);
        }

        pendingLines = [];
        index += 1;
        continue;
      }

      if (pendingLines.length > 12) {
        pendingLines = pendingLines.slice(-12);
      }
      continue;
    }

    const entryLines = getDescriptionBeforeValue(line) ? [line] : pendingLines;
    const entry = extractEntryFromLines(entryLines);

    if (entry) {
      entries.push(entry);
    }

    pendingLines = [];
  }

  return entries;
}

function summarizeEntries(entries) {
  const totalDebitos = entries
    .filter((entry) => entry.tipo === 'D')
    .reduce((sum, entry) => sum + entry.valorNumero, 0);
  const totalCreditos = entries
    .filter((entry) => entry.tipo === 'C')
    .reduce((sum, entry) => sum + entry.valorNumero, 0);

  return {
    totalDebitos,
    totalCreditos,
    saldo: totalCreditos - totalDebitos,
    countDebitos: entries.filter((entry) => entry.tipo === 'D').length,
    countCreditos: entries.filter((entry) => entry.tipo === 'C').length
  };
}

function addDebitSequence(entries) {
  let sequence = 1;

  return entries.map((entry) => {
    if (entry.tipo !== 'D') {
      return entry;
    }

    const sequencia = sequence;
    sequence += 1;

    return {
      ...entry,
      sequencia
    };
  });
}

function drawPdfHeader(doc, title) {
  doc
    .fontSize(18)
    .fillColor('#18212f')
    .text(title, { align: 'left' })
    .moveDown(0.3);

  doc
    .fontSize(9)
    .fillColor('#657287')
    .text(`Gerado em ${new Date().toLocaleString('pt-BR')}`)
    .moveDown(1);
}

function drawPdfSummary(doc, entries) {
  const summary = summarizeEntries(entries);

  doc
    .fontSize(10)
    .fillColor('#18212f')
    .text(`Quantidade de debitos: ${summary.countDebitos}`)
    .text(`Total dos debitos: R$ ${formatBrazilianMoney(summary.totalDebitos)}`)
    .moveDown(1);
}

function drawTableHeader(doc, columns, y) {
  doc.rect(doc.page.margins.left, y, 742, 22).fill('#eef2f6');
  doc.fillColor('#18212f').fontSize(9).font('Helvetica-Bold');

  columns.forEach((column) => {
    doc.text(column.label, column.x, y + 7, {
      width: column.width,
      align: column.align || 'left'
    });
  });

  doc.font('Helvetica');
  return y + 22;
}

function buildDebitsPdf(res, entries) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 42,
    bufferPages: true
  });

  const columns = [
    { label: '#', x: 42, width: 32 },
    { label: 'Data', x: 80, width: 64 },
    { label: 'Descricao', x: 150, width: 290 },
    { label: 'Observacao', x: 450, width: 205 },
    { label: 'Valor', x: 665, width: 119, align: 'right' }
  ];

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="debitos-extrato.pdf"');
  doc.pipe(res);

  drawPdfHeader(doc, 'Debitos do extrato');
  drawPdfSummary(doc, entries);

  let y = drawTableHeader(doc, columns, doc.y);
  const bottom = doc.page.height - doc.page.margins.bottom;

  entries.forEach((entry) => {
    const descriptionHeight = doc.heightOfString(entry.descricao || '-', {
      width: columns[1].width
    });
    const observationHeight = doc.heightOfString(entry.observacao || '-', {
      width: columns[2].width
    });
    const rowHeight = Math.max(30, descriptionHeight, observationHeight) + 12;

    if (y + rowHeight > bottom) {
      doc.addPage();
      y = drawTableHeader(doc, columns, doc.page.margins.top);
    }

    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(784, y)
      .strokeColor('#d9e0ea')
      .stroke();

    doc.fillColor('#18212f').fontSize(9);
    doc.text(String(entry.sequencia || '-'), columns[0].x, y + 8, { width: columns[0].width });
    doc.text(entry.data || '-', columns[1].x, y + 8, { width: columns[1].width });
    doc.text(entry.descricao || '-', columns[2].x, y + 8, { width: columns[2].width });
    doc.text(entry.observacao || '-', columns[3].x, y + 8, { width: columns[3].width });
    doc.text(`R$ ${entry.valor}`, columns[4].x, y + 8, {
      width: columns[4].width,
      align: 'right'
    });

    y += rowHeight;
  });

  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(784, y)
    .strokeColor('#d9e0ea')
    .stroke();

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .fontSize(8)
      .fillColor('#657287')
      .text(`Pagina ${index + 1} de ${range.count}`, 42, doc.page.height - 30, {
        align: 'right'
      });
  }

  doc.end();
}

function buildWorkbook(entries, summary = summarizeEntries(entries)) {
  const rows = entries.map((entry) => ({
    Data: entry.data,
    Descricao: entry.descricao,
    Tipo: entry.tipo === 'C' ? 'Credito' : 'Debito',
    Valor: entry.valorNumero
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ['Data', 'Descricao', 'Tipo', 'Valor']
  });

  worksheet['!cols'] = [
    { wch: 14 },
    { wch: 60 },
    { wch: 12 },
    { wch: 16 }
  ];

  const summaryWorksheet = XLSX.utils.json_to_sheet([
    { Indicador: 'Total de creditos (entrada)', Valor: summary.totalCreditos },
    { Indicador: 'Total de debitos (saida)', Valor: summary.totalDebitos },
    { Indicador: 'Saldo', Valor: summary.saldo },
    { Indicador: 'Quantidade de creditos', Valor: summary.countCreditos },
    { Indicador: 'Quantidade de debitos', Valor: summary.countDebitos }
  ]);

  summaryWorksheet['!cols'] = [{ wch: 32 }, { wch: 16 }];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lancamentos');
  XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Resumo');
  return workbook;
}

app.post('/api/upload', requireAuth, upload.single('pdf'), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: 'Nenhum PDF foi enviado.' });
    return;
  }

  const filePath = req.file.path;

  try {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer, {
      max: 0
    });

    const allEntries = addDebitSequence(extractEntries(parsed.text));
    const debitEntries = allEntries.filter((entry) => entry.tipo === 'D');
    const summary = summarizeEntries(allEntries);

    res.json({
      fileName: req.file.originalname,
      pages: parsed.numpages || 0,
      count: debitEntries.length,
      allCount: allEntries.length,
      total: summary.totalDebitos,
      totalFormatado: formatBrazilianMoney(summary.totalDebitos),
      summary: {
        ...summary,
        totalDebitosFormatado: formatBrazilianMoney(summary.totalDebitos),
        totalCreditosFormatado: formatBrazilianMoney(summary.totalCreditos),
        saldoFormatado: formatBrazilianMoney(summary.saldo)
      },
      entries: debitEntries.map((entry) => ({
        sequencia: entry.sequencia,
        data: entry.data,
        descricao: entry.descricao,
        valor: entry.valor,
        valorNumero: entry.valorNumero,
        tipo: entry.tipo
      }))
    });
  } catch (error) {
    next(error);
  } finally {
    fs.promises.unlink(filePath).catch(() => {});
  }
});

app.post('/api/export', requireAuth, (req, res, next) => {
  try {
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];

    if (!entries.length) {
      res.status(400).json({ error: 'Nao ha lancamentos para exportar.' });
      return;
    }

    const normalizedEntries = entries.map((entry) => ({
      data: normalizeSpaces(entry.data),
      descricao: normalizeSpaces(entry.descricao),
      sequencia: Number(entry.sequencia) || 0,
      valor: normalizeSpaces(entry.valor),
      observacao: normalizeSpaces(entry.observacao),
      valorNumero: Number(entry.valorNumero) || parseBrazilianMoney(entry.valor),
      tipo: normalizeSpaces(entry.tipo || 'D').toUpperCase() === 'C' ? 'C' : 'D'
    }));

    buildDebitsPdf(res, normalizedEntries.filter((entry) => entry.tipo === 'D'));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = error.message && error.message.includes('File too large') ? 413 : 500;
  const message =
    status === 413
      ? `O PDF ultrapassa o limite de ${MAX_FILE_SIZE_MB} MB.`
      : error.message || 'Erro ao processar o PDF.';

  res.status(status).json({ error: message });
});

async function startServer() {
  try {
    const databaseName = await initializeDatabase();
    console.log(`Banco de dados ${databaseName} conectado e tabela de usuarios pronta.`);

    const server = app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`A porta ${PORT} ja esta em uso. Feche o outro servidor ou inicie com outra porta:`);
        console.error(`$env:PORT=3001; npm start`);
        process.exit(1);
      }

      console.error('Erro ao iniciar o servidor:', error.message);
      process.exit(1);
    });
  } catch (error) {
    console.error('Erro ao conectar ao Neon:', error.message);
    process.exit(1);
  }
}

startServer();
