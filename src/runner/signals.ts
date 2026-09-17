/**
 * One shutdown request per process. Ctrl+C in a terminal reaches both npm and the node child,
 * and npm forwards it again, so the same signal arrives more than once; a second delivery must
 * not fall through to the default action and kill the process before the manifest is written.
 */
export function createSignalHandler(controller: AbortController, write: (message: string) => void): (signal: string) => void {
  let stopping = false;
  return (signal: string) => {
    if (stopping) {
      write(`${signal} received again: already stopping, the current keyword still finishes\n`);
      return;
    }
    stopping = true;
    write(`${signal} received: finishing the current keyword, skipping the rest\n`);
    controller.abort();
  };
}
