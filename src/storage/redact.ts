/** Remove the secret parts of SAS URLs and connection strings from text bound for logs or manifests. */
export function redactSecrets(text: string): string {
  return text
    .replace(/([?&]sig=)[^&\s"'<>]*/gi, '$1REDACTED')
    .replace(/(AccountKey=)[^;\s"'<>]*/gi, '$1REDACTED');
}
