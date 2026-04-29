// tests/auth.test.js
const { hashPassword, verifyPassword } = require('../auth')

describe('password hashing', () => {
  test('hashPassword returns a non-empty string different from input', async () => {
    const hash = await hashPassword('secret123')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(20)
    expect(hash).not.toBe('secret123')
  })

  test('verifyPassword returns true for matching password', async () => {
    const hash = await hashPassword('secret123')
    expect(await verifyPassword('secret123', hash)).toBe(true)
  })

  test('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('secret123')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})
