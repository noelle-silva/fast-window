import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOST_PROFILE_DEV,
  HOST_PROFILE_ENV,
  HOST_PROFILE_RELEASE,
  TAURI_CONFIG_ENV,
  HOST_TAURI_BUILD_CHANNEL_ENV,
  HOST_TAURI_BUILD_CHANNEL_MANAGED,
  HOST_VITE_PROFILE_ENV,
  assertHostTauriBuildAllowed,
  hostDevProfileEnv,
  hostReleaseProfileEnv,
  managedHostTauriBuildEnv,
} from './lib/host-tauri-build-policy.mjs'

test('host dev profile env marks runtime and frontend as dev', () => {
  const env = hostDevProfileEnv({ EXISTING: 'kept' })

  assert.equal(env.EXISTING, 'kept')
  assert.equal(env[HOST_PROFILE_ENV], HOST_PROFILE_DEV)
  assert.equal(env[HOST_VITE_PROFILE_ENV], HOST_PROFILE_DEV)
})

test('managed host build env overrides inherited dev profile with release profile', () => {
  const env = managedHostTauriBuildEnv({
    [HOST_PROFILE_ENV]: HOST_PROFILE_DEV,
    [HOST_VITE_PROFILE_ENV]: HOST_PROFILE_DEV,
    [TAURI_CONFIG_ENV]: '{"productName":"Fast Window-dev"}',
  })

  assert.equal(env[HOST_PROFILE_ENV], HOST_PROFILE_RELEASE)
  assert.equal(env[HOST_VITE_PROFILE_ENV], HOST_PROFILE_RELEASE)
  assert.equal(env[HOST_TAURI_BUILD_CHANNEL_ENV], HOST_TAURI_BUILD_CHANNEL_MANAGED)
  assert.equal(env[TAURI_CONFIG_ENV], undefined)
})

test('managed host tauri build rejects non-release profile env', () => {
  assert.throws(
    () => assertHostTauriBuildAllowed(['build', '-b', 'msi'], {
      [HOST_TAURI_BUILD_CHANNEL_ENV]: HOST_TAURI_BUILD_CHANNEL_MANAGED,
      [HOST_PROFILE_ENV]: HOST_PROFILE_DEV,
      [HOST_VITE_PROFILE_ENV]: HOST_PROFILE_DEV,
    }),
    /release profile/,
  )
})

test('managed host tauri build accepts release profile env', () => {
  assert.doesNotThrow(() => assertHostTauriBuildAllowed(['build', '-b', 'msi'], hostReleaseProfileEnv({
    [HOST_TAURI_BUILD_CHANNEL_ENV]: HOST_TAURI_BUILD_CHANNEL_MANAGED,
  })))
})

test('managed host tauri build rejects inherited tauri config', () => {
  assert.throws(
    () => assertHostTauriBuildAllowed(['build', '-b', 'msi'], hostReleaseProfileEnv({
      [HOST_TAURI_BUILD_CHANNEL_ENV]: HOST_TAURI_BUILD_CHANNEL_MANAGED,
      [TAURI_CONFIG_ENV]: '{"productName":"Fast Window-dev"}',
    })),
    /TAURI_CONFIG/,
  )
})
