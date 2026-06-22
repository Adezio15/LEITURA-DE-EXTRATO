const uploadForm = document.getElementById('uploadForm');
const pdfFile = document.getElementById('pdfFile');
const fileLabel = document.getElementById('fileLabel');
const uploadButton = document.getElementById('uploadButton');
const downloadButton = document.getElementById('downloadButton');
const resultsBody = document.getElementById('resultsBody');
const statusText = document.getElementById('statusText');
const pagesCount = document.getElementById('pagesCount');
const entriesCount = document.getElementById('entriesCount');
const creditsCount = document.getElementById('creditsCount');
const creditValue = document.getElementById('creditValue');
const debitValue = document.getElementById('debitValue');
const balanceValue = document.getElementById('balanceValue');
const barChart = document.getElementById('barChart');
const donutChart = document.getElementById('donutChart');
const currentUserName = document.getElementById('currentUserName');
const logoutButton = document.getElementById('logoutButton');

let currentEntries = [];

async function loadCurrentUser() {
  const response = await fetch('/api/auth/me');
  if (!response.ok) {
    window.location.href = '/login';
    return;
  }
  const data = await response.json();
  currentUserName.textContent = data.user?.name || data.user?.email || 'Usuário';
}

logoutButton?.addEventListener('click', async () => {
  logoutButton.disabled = true;
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function renderEmpty(message) {
  resultsBody.innerHTML = `
    <tr>
      <td colspan="6" class="empty-state">${message}</td>
    </tr>
  `;
}

function drawBarChart(summary = {}) {
  const ctx = barChart.getContext('2d');
  const width = barChart.width;
  const height = barChart.height;
  const padding = 42;
  const chartHeight = height - padding * 2;
  const maxValue = Math.max(summary.totalCreditos || 0, summary.totalDebitos || 0, 1);
  const bars = [
    { label: 'Entrou', value: summary.totalCreditos || 0, color: '#047857' },
    { label: 'Saiu', value: summary.totalDebitos || 0, color: '#b42318' }
  ];

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d9e0ea';
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  bars.forEach((bar, index) => {
    const barWidth = 110;
    const gap = 90;
    const x = width / 2 - barWidth - gap / 2 + index * (barWidth + gap);
    const barHeight = Math.round((bar.value / maxValue) * chartHeight);
    const y = height - padding - barHeight;

    ctx.fillStyle = bar.color;
    ctx.fillRect(x, y, barWidth, barHeight || 2);
    ctx.fillStyle = '#18212f';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(bar.label, x + barWidth / 2, height - 16);
    ctx.font = '14px Arial';
    ctx.fillText(formatCurrency(bar.value), x + barWidth / 2, Math.max(24, y - 10));
  });
}

function drawDonutChart(summary = {}) {
  const ctx = donutChart.getContext('2d');
  const width = donutChart.width;
  const height = donutChart.height;
  const centerX = width / 2;
  const centerY = height / 2 - 8;
  const radius = Math.min(width, height) / 3;
  const values = [
    { label: 'Creditos', value: summary.totalCreditos || 0, color: '#047857' },
    { label: 'Debitos', value: summary.totalDebitos || 0, color: '#b42318' }
  ];
  const total = values.reduce((sum, item) => sum + item.value, 0);
  let startAngle = -Math.PI / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  if (!total) {
    ctx.fillStyle = '#657287';
    ctx.font = '15px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Sem valores para exibir', centerX, centerY);
    return;
  }

  values.forEach((item) => {
    const slice = (item.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    startAngle += slice;
  });

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();

  ctx.fillStyle = '#18212f';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Total', centerX, centerY - 4);
  ctx.font = '14px Arial';
  ctx.fillText(formatCurrency(total), centerX, centerY + 18);

  values.forEach((item, index) => {
    const x = 32 + index * 170;
    const y = height - 28;
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y - 10, 12, 12);
    ctx.fillStyle = '#334155';
    ctx.font = '13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, x + 18, y);
  });
}

function resetDashboard() {
  pagesCount.textContent = '0';
  entriesCount.textContent = '0';
  creditsCount.textContent = '0';
  creditValue.textContent = formatCurrency(0);
  debitValue.textContent = formatCurrency(0);
  balanceValue.textContent = formatCurrency(0);
  drawBarChart();
  drawDonutChart();
}

function renderResults(entries) {
  if (!entries.length) {
    renderEmpty('Nenhum lancamento com valor terminado em D foi encontrado.');
    return;
  }

  const fragment = document.createDocumentFragment();

  entries.forEach((entry, index) => {
    const row = document.createElement('tr');

    const sequenceCell = document.createElement('td');
    sequenceCell.textContent = entry.sequencia || index + 1;

    const dateCell = document.createElement('td');
    dateCell.textContent = entry.data || '-';

    const descriptionCell = document.createElement('td');
    descriptionCell.textContent = entry.descricao || '-';

    const observationCell = document.createElement('td');
    const observationInput = document.createElement('textarea');
    observationInput.className = 'observation-input';
    observationInput.placeholder = 'Inserir observacao';
    observationInput.rows = 2;
    observationInput.value = entry.observacao || '';
    observationInput.addEventListener('input', () => {
      currentEntries[index].observacao = observationInput.value;
    });
    observationCell.appendChild(observationInput);

    const typeCell = document.createElement('td');
    typeCell.textContent = entry.tipo === 'C' ? 'Credito' : 'Debito';

    const valueCell = document.createElement('td');
    valueCell.textContent = `R$ ${entry.valor}`;

    row.append(sequenceCell, dateCell, descriptionCell, observationCell, typeCell, valueCell);
    fragment.append(row);
  });

  resultsBody.replaceChildren(fragment);
}

pdfFile.addEventListener('change', () => {
  const file = pdfFile.files[0];
  fileLabel.textContent = file ? file.name : 'Selecionar PDF';
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = pdfFile.files[0];
  if (!file) {
    setStatus('Selecione um PDF antes de processar.', true);
    return;
  }

  const formData = new FormData();
  formData.append('pdf', file);

  uploadButton.disabled = true;
  downloadButton.disabled = true;
  currentEntries = [];
  setStatus('Processando PDF. Em arquivos grandes isso pode levar alguns segundos...');
  renderEmpty('Processando arquivo...');

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Nao foi possivel processar o PDF.');
    }

    currentEntries = data.entries || [];
    const summary = data.summary || {};
    pagesCount.textContent = data.pages || 0;
    entriesCount.textContent = summary.countDebitos || data.count || 0;
    creditsCount.textContent = summary.countCreditos || 0;
    creditValue.textContent = formatCurrency(summary.totalCreditos || 0);
    debitValue.textContent = formatCurrency(summary.totalDebitos || data.total || 0);
    balanceValue.textContent = formatCurrency(summary.saldo || 0);
    drawBarChart(summary);
    drawDonutChart(summary);
    downloadButton.disabled = currentEntries.length === 0;
    setStatus(`${data.fileName} processado com sucesso.`);
    renderResults(currentEntries);
  } catch (error) {
    resetDashboard();
    setStatus(error.message, true);
    renderEmpty('Nao foi possivel exibir resultados.');
  } finally {
    uploadButton.disabled = false;
  }
});

downloadButton.addEventListener('click', async () => {
  if (!currentEntries.length) {
    return;
  }

  downloadButton.disabled = true;
  setStatus('Gerando PDF dos debitos...');

  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ entries: currentEntries })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Nao foi possivel gerar o PDF.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'debitos-extrato.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus('PDF gerado com sucesso.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    downloadButton.disabled = currentEntries.length === 0;
  }
});

resetDashboard();
loadCurrentUser();
