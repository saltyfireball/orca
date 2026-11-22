// Goal loop (BAD-682, FORK.md): runs the user's judge command (`forkGoalJudgeCommand`). It is one
// shell line that reads a JSON object on stdin (the criteria, and the agent's last message fenced
// as untrusted data) and prints a verdict. The command is the user's own setting, never agent
// text. A failed start, a non-zero exit, a timeout or too much output is a verdict of not met.
import { spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import {
  judgeInput,
  parseJudgeVerdict,
  type GoalJudgeVerdict,
  type GoalLoopSettings
} from '../../../shared/fork/goal-loop'
import { stopClassifier } from '../idle-recovery/idle-recovery-classifier'

const MAX_STDOUT_BYTES = 64 * 1024

function notMet(reason: string): GoalJudgeVerdict {
  return { met: false, reason }
}

export function runGoalJudge(
  command: string,
  criteria: string,
  agentOutput: string,
  settings: Pick<GoalLoopSettings, 'timeoutMs'>
): Promise<GoalJudgeVerdict> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(command, {
        cwd: homedir(),
        detached: process.platform !== 'win32',
        env: process.env,
        shell: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      })
    } catch {
      resolve(notMet('The judge command could not be started.'))
      return
    }
    const chunks: Buffer[] = []
    let bytes = 0
    let exited = false
    let settled = false
    const settle = (verdict: GoalJudgeVerdict, stop: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (stop) {
        stopClassifier(child, () => exited)
      }
      resolve(verdict)
    }
    const timer = setTimeout(
      () => settle(notMet('The judge command timed out.'), true),
      settings.timeoutMs
    )
    child.once('exit', () => {
      exited = true
    })
    child.once('error', () => settle(notMet('The judge command could not be started.'), true))
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_STDOUT_BYTES) {
        settle(notMet('The judge output was too large.'), true)
        return
      }
      chunks.push(chunk)
    })
    child.once('close', (code) => {
      settle(
        code === 0
          ? parseJudgeVerdict(Buffer.concat(chunks).toString('utf8'))
          : notMet('The judge command failed.'),
        false
      )
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(judgeInput(criteria, agentOutput))
  })
}
