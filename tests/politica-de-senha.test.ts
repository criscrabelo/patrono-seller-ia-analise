import test from 'node:test'
import assert from 'node:assert/strict'
import { validarSenhaNova, SENHA_MINIMA } from '../lib/politica-de-senha'

test('A8/A15: senha nova precisa ter o mínimo e não ser óbvia', () => {
  assert.equal(SENHA_MINIMA, 10)
  assert.notEqual(validarSenhaNova('curta1'), null)
  assert.notEqual(validarSenhaNova('123456'), null)
  assert.notEqual(validarSenhaNova('1234567890'), null)
  assert.notEqual(validarSenhaNova('aaaaaaaaaaaa'), null)
  assert.notEqual(validarSenhaNova(undefined), null)
  assert.notEqual(validarSenhaNova(1234567890123), null)
  assert.notEqual(validarSenhaNova('1111111112'), null)
  assert.notEqual(validarSenhaNova('senha1234567'), null)
  assert.notEqual(validarSenhaNova('qwertyuiop1'), null)
  assert.notEqual(validarSenhaNova('a'.repeat(40) + 'bcdefghijklmnopqrstuvwxyz0123456789'), null, 'acima de 72 bytes')
  assert.equal(validarSenhaNova('Teste@12345'), null)
  assert.equal(validarSenhaNova('uma frase longa e boa'), null)
})
