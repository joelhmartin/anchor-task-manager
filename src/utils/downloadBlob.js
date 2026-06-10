/**
 * Trigger a browser download for a Blob (e.g. a CSV export response).
 * Creates a temporary object URL + anchor, clicks it, then revokes the URL.
 */
export default function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Append to the DOM before clicking — Firefox ignores clicks on detached anchors.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
