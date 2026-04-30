// public/js/header.js — общий код шапки
async function initHeader() {
  const me = await fetch('/api/users/me').then(r => r.json())
  document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = me.full_name)
  document.querySelectorAll('[data-logout]').forEach(el => {
    el.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' })
      window.location.href = '/login'
    })
  })
  document.querySelectorAll('[data-change-password]').forEach(el => {
    el.addEventListener('click', () => {
      const oldP = prompt('Старый пароль:')
      if (!oldP) return
      const newP = prompt('Новый пароль:')
      if (!newP) return
      const newP2 = prompt('Повторите новый пароль:')
      if (newP !== newP2) { alert('Пароли не совпадают'); return }
      fetch('/api/users/me/change-password', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ old_password: oldP, new_password: newP })
      }).then(r => alert(r.ok ? 'Пароль обновлён' : 'Ошибка: проверьте старый пароль'))
    })
  })
}
document.addEventListener('DOMContentLoaded', initHeader)
