export interface ActiveChatJob {
  stream_id: string;
  session_id: string;
  needs_input?: boolean;
}

export function activeSessionIdsFromJobs(jobs: ActiveChatJob[] | undefined): Set<string> {
  return new Set(
    (jobs ?? [])
      .map((job) => job.session_id)
      .filter((sessionId) => sessionId.trim().length > 0),
  );
}
