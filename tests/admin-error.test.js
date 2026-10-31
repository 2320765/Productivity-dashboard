import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminError } from '../src/adminError.js';
test('admin errors distinguish denial, expired session and retry without exposing server payloads', () => {
  assert.match(adminError({code:'42501'}),/Доступ запрещён/);
  assert.match(adminError({code:'PGRST301'}),/Сессия истекла/);
  assert.match(adminError({code:'P0002'}),/Обновите список/);
  assert.match(adminError({code:'22023'}),/3–200/);
  assert.doesNotMatch(adminError({message:'SECRET_TOKEN',details:'user@example.com',hint:'private note'}),/SECRET|example|private/);
});
