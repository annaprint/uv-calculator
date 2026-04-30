// public/js/login.js
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(e.target)
  const err = document.getElementById('err')
  err.textContent = ''
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
    })
    if (res.ok) {
      window.location.href = '/'
    } else if (res.status === 429) {
      err.textContent = 'Слишком много попыток. Подождите минуту.'
    } else {
      err.textContent = 'Неверный email или пароль.'
    }
  } catch (e) {
    err.textContent = 'Ошибка сети. Попробуйте ещё раз.'
  }
})
