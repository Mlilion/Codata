const SKILL_PATH_PATTERN = /^skills\/([^/]+)\//;
const CONVENTIONAL_SUBJECT_PATTERN =
  /^(?<type>[a-z][a-z0-9-]*)(?:\((?<scope>[^()\n]+)\))?(?<breaking>!)?: (?<description>\S[\s\S]*)$/;

export function parseConventionalCommitSubject(subject) {
  const match = CONVENTIONAL_SUBJECT_PATTERN.exec(subject.trim());
  if (!match?.groups) return null;

  return {
    type: match.groups.type,
    scope: match.groups.scope ?? "",
    breaking: Boolean(match.groups.breaking),
    description: match.groups.description,
  };
}

export function changedSkillsForPaths(paths) {
  const skills = new Set();
  for (const filePath of paths) {
    const normalizedPath = filePath.replaceAll("\\", "/");
    const match = SKILL_PATH_PATTERN.exec(normalizedPath);
    if (match) skills.add(match[1]);
  }
  return [...skills].sort((left, right) => left.localeCompare(right));
}

export function validateSkillReleaseCommit({ commit = "", subject, paths }) {
  const skills = changedSkillsForPaths(paths);
  if (skills.length === 0) return [];

  const parsed = parseConventionalCommitSubject(subject);
  if (parsed) return [];

  return [
    {
      commit,
      subject,
      skills,
      message: `Commit ${formatCommit(commit)} changes ${formatSkills(skills)} but its subject is not a Conventional Commit: ${subject}`,
    },
  ];
}

export function formatSkillReleaseFailures(failures) {
  if (failures.length === 0) return "";

  const lines = [
    "Skill release commit check failed.",
    "",
    "Commits that touch skills/<name>/** must use Conventional Commit subjects so per-skill release tooling can derive a version bump.",
    "Example: fix(baoyu-post-to-wechat): handle WeChat editor focus",
    "",
  ];

  for (const failure of failures) {
    lines.push(`- ${failure.message}`);
  }

  return lines.join("\n");
}

function formatCommit(commit) {
  return commit ? commit.slice(0, 12) : "<unknown>";
}

function formatSkills(skills) {
  return skills.map((skill) => `skills/${skill}/**`).join(", ");
}
