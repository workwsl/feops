import { execSync } from 'child_process';

export type RefPreference = 'remote' | 'local';

export interface ResolvedGitRef {
  ref: string;
  exists: boolean;
  source: 'remote' | 'local' | 'none';
}

function refExists(projectPath: string, ref: string): boolean {
  try {
    execSync(`git rev-parse --verify ${ref}`, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveGitRef(
  projectPath: string,
  branchName: string,
  preference: RefPreference = 'remote'
): ResolvedGitRef {
  const remoteRef = `origin/${branchName}`;
  const localRef = branchName;

  const order =
    preference === 'remote'
      ? [
          { ref: remoteRef, source: 'remote' as const },
          { ref: localRef, source: 'local' as const }
        ]
      : [
          { ref: localRef, source: 'local' as const },
          { ref: remoteRef, source: 'remote' as const }
        ];

  for (const { ref, source } of order) {
    if (refExists(projectPath, ref)) {
      return { ref, exists: true, source };
    }
  }

  return { ref: branchName, exists: false, source: 'none' };
}
