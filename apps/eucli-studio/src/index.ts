import { detectRuntime } from './runtime/detectRuntime'

if (detectRuntime() === 'background') {
  import('./backend/bootstrap')
} else {
  import('./render/vendor')
  import('./bootstrap')
}
