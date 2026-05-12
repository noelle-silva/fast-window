export function scriptArgs(argv) {
  return argv.slice(2).filter(arg => arg !== '--')
}
