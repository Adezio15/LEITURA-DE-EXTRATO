const authForm = document.querySelector('[data-auth-form]');
const authMessage = document.querySelector('.auth-message');

if (authForm?.dataset.authForm === 'login' && new URLSearchParams(window.location.search).get('cadastro') === 'sucesso') {
  authMessage.classList.add('success');
  authMessage.textContent = 'Cadastro realizado com sucesso. Entre com seu e-mail e senha.';
}

function clearLoginFields() {
  if (authForm?.dataset.authForm !== 'login') return;
  authForm.querySelectorAll('input').forEach((input) => {
    input.value = '';
  });
}

window.addEventListener('pageshow', clearLoginFields);

async function offerCredentialSave(payload) {
  const wantsToSave = window.confirm('Deseja que o navegador salve seu login e sua senha?');
  if (!wantsToSave || !window.PasswordCredential || !navigator.credentials?.store) return;

  try {
    const credential = new PasswordCredential({
      id: payload.email,
      password: payload.password
    });
    await navigator.credentials.store(credential);
  } catch (error) {
    console.warn('O navegador nao permitiu salvar as credenciais.', error);
  }
}

authForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  authMessage.textContent = '';
  authMessage.classList.remove('success');

  const mode = authForm.dataset.authForm;
  const button = authForm.querySelector('button[type="submit"]');
  const formData = new FormData(authForm);
  const payload = Object.fromEntries(formData.entries());

  if (mode === 'cadastro' && payload.password !== payload.passwordConfirmation) {
    authMessage.textContent = 'As senhas não conferem.';
    return;
  }

  button.disabled = true;
  button.textContent = mode === 'login' ? 'Entrando...' : 'Cadastrando...';

  try {
    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');

    authMessage.classList.add('success');
    authMessage.textContent = mode === 'login' ? 'Login realizado.' : 'Cadastro realizado.';
    if (mode === 'login') await offerCredentialSave(payload);
    window.location.href = mode === 'login' ? '/' : '/login?cadastro=sucesso';
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = mode === 'login' ? 'Entrar' : 'Cadastrar';
  }
});
