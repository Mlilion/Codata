// Sessions can accumulate hidden system turns that do not render in the thread.
// Keeping the initial page larger than 50 avoids clipping the latest visible turn.
export const MESSAGE_PAGE_SIZE = 100;
