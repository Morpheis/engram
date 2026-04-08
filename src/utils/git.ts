import { execFileSync } from 'child_process';

export interface DiffFile {
  status: 'A' | 'M' | 'D' | 'R';
  path: string;
  oldPath?: string; // for renames
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Get the HEAD commit hash for a repository.
 */
export function getHeadCommit(repoPath: string): string {
  try {
    return runGit(repoPath, ['rev-parse', 'HEAD']);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.includes('not a git repository')) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
    throw new Error(`Failed to get HEAD commit: ${msg}`);
  }
}

/**
 * Get the list of changed files between a commit and HEAD.
 * If fromCommit is null, lists all tracked files (effectively a full diff).
 */
export function getDiffFiles(repoPath: string, fromCommit: string | null): DiffFile[] {
  try {
    const output = fromCommit
      ? runGit(repoPath, ['diff', '--name-status', `${fromCommit}..HEAD`])
      : runGit(repoPath, ['ls-files']);


    if (!output) return [];

    if (!fromCommit) {
      // ls-files returns just file paths — treat all as "added"
      return output.split('\n').map(line => ({
        status: 'A' as const,
        path: line.trim(),
      }));
    }

    return output.split('\n').map(line => {
      const parts = line.split('\t');
      const statusChar = parts[0].charAt(0) as 'A' | 'M' | 'D' | 'R';

      if (statusChar === 'R') {
        // Renames: R100\toldpath\tnewpath
        return {
          status: 'R' as const,
          path: parts[2],
          oldPath: parts[1],
        };
      }

      return {
        status: statusChar,
        path: parts[1],
      };
    });
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.includes('unknown revision')) {
      throw new Error(`Unknown commit: ${fromCommit}`);
    }
    throw new Error(`Failed to get diff files: ${msg}`);
  }
}

/**
 * Get the diff stat (summary) between a commit and HEAD.
 */
export function getDiffStat(repoPath: string, fromCommit: string | null): string {
  try {
    return fromCommit
      ? runGit(repoPath, ['diff', '--stat', `${fromCommit}..HEAD`])
      : runGit(repoPath, ['diff', '--stat', 'HEAD']);
  } catch {
    return '';
  }
}

/**
 * Get a human-readable commit age string, e.g. "7 days ago".
 */
export function getCommitAge(repoPath: string, commit: string): string {
  try {
    return runGit(repoPath, ['log', '-1', '--format=%cr', commit]);
  } catch {
    return 'unknown';
  }
}

/**
 * Get the number of commits between two commits.
 */
export function getCommitCount(repoPath: string, fromCommit: string, toCommit: string): number {
  try {
    const output = runGit(repoPath, ['rev-list', '--count', `${fromCommit}..${toCommit}`]);
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a commit exists in the repository.
 */
export function commitExists(repoPath: string, commit: string): boolean {
  try {
    runGit(repoPath, ['cat-file', '-t', commit]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get abbreviated commit hash (7 chars).
 */
export function abbreviateCommit(hash: string): string {
  return hash.substring(0, 7);
}
