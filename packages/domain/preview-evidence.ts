export interface PreviewObservation {
  preview_url: string;
  expected_commit: string;
  result: "reachable" | "http_error" | "redirect_denied" | "network_error";
  http_status: number | null;
  reported_commit: string | null;
  commit_matches: number | null;
  observed_at: string;
}
