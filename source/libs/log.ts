export const log = (message: String) => {
  const output = document.getElementById('output') as HTMLPreElement
  output.textContent += new Date().toLocaleTimeString() + ': ' + message + '\n'
  output.scrollTop = output.scrollHeight
}