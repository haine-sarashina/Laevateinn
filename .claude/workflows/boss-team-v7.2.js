export const meta = {
  name: 'boss-team-v7.2',
  description: 'Boss-managed multi-agent team v7.2 — all agents effort:max for local model performance',
  phases: [
    { title: 'Assistant', detail: 'Gather project context' },
    { title: 'Plan', detail: 'Create per-file task specs' },
    { title: 'Program', detail: 'Parallel programmers (max 4)' },
    { title: 'Verify', detail: 'Batch verify all changes' },
    { title: 'Document', detail: 'Update documentation' },
    { title: 'Retrospective', detail: 'Learn from this cycle' },
  ],
}

// ========== SCHEMA DEFINITIONS ==========

const ASSISTANT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Short project status summary (<150 words)' },
    files: {
      type: 'array',
      items: { type: 'string', description: 'File path with recent changes' },
    },
  },
  required: ['summary'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    taskSpecs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                instruction: { type: 'string', description: '<500 chars, specific change' },
                lineRange: { type: 'string', description: 'e.g. "10-25" or "entire file"' },
              },
              required: ['path', 'instruction'],
            },
          },
        },
        required: ['title', 'files'],
      },
    },
  },
  required: ['taskSpecs'],
}

const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { enum: ['error', 'warning'] },
          message: { type: 'string' },
        },
        required: ['file', 'message'],
      },
    },
  },
  required: ['passed'],
}

const DOC_SCHEMA = {
  type: 'object',
  properties: {
    updated: { type: 'boolean' },
    summary: { type: 'string', description: 'What was documented' },
  },
  required: ['updated'],
}

const RETRO_SCHEMA = {
  type: 'object',
  properties: {
    whatWorked: { type: 'array', items: { type: 'string' } },
    whatFailed: { type: 'array', items: { type: 'string' } },
    actionItems: {
      type: 'array',
      items: { type: 'string', description: 'Concrete improvement for next cycle' },
    },
  },
  required: ['whatWorked', 'actionItems'],
}

// ========== HELPER FUNCTIONS ==========

function findTasksMd() {
  const fs = require('fs')
  const path = require('path')

  // 親ディレクトリの Obsidian プロジェクトフォルダを探索
  const rootDir = process.cwd()
  const possiblePaths = [
    path.join(rootDir, 'src-tauri', 'tasks.md'),
    path.join(rootDir, '..', 'Memo', 'projects', 'Laevateinn', 'tasks.md'),
    path.join(rootDir, '..', 'Memo', 'retrospectives'), // retrospectives ディレクトリもチェック
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log(`Found tasks file: ${p}`)
      return p
    }
  }

  // 親ディレクトリを遡って .obsidian/ を探す
  let current = path.dirname(rootDir)
  while (current !== path.dirname(current)) {
    const obsidianPath = path.join(current, '.obsidian')
    if (fs.existsSync(obsidianPath)) {
      log(`Found Obsidian directory: ${obsidianPath}`)
      // tasks.md を探索
      try {
        const files = fs.readdirSync(current)
        for (const file of files) {
          if (file === 'tasks.md') {
            return path.join(current, file)
          }
        }
      } catch (e) {}
    }
    current = path.dirname(current)
  }

  // デフォルト
  log('No tasks.md found, using src-tauri/tasks.md')
  return path.join(rootDir, 'src-tauri', 'tasks.md')
}

function splitIntoSubtasks(taskSpecs) {
  const subtasks = []
  for (const task of taskSpecs || []) {
    for (const file of task.files || []) {
      if (file.instruction && file.path) {
        subtasks.push({
          taskId: task.title,
          path: file.path,
          instruction: file.instruction,
          lineRange: file.lineRange || 'entire file',
          description: file.description || task.description || '',
        })
      }
    }
  }
  return subtasks
}

function buildProgrammerPrompt(subtask) {
  return (
    `Perform this single focused change:\n` +
    `\n` +
    `## File: ${subtask.path}\n` +
    `## Scope: ${subtask.lineRange}\n` +
    `## Instruction:\n${subtask.instruction}\n` +
    `\n` +
    `Read the file first. Make ONLY this change. Do not touch other files.\n` +
    `After editing, verify syntax is correct. Return a summary of what changed.`
  ).slice(0, 2000)
}

// ========== MAIN WORKFLOW ==========

const task = args || {}
const request = typeof task === 'string' ? task : (task.request || '')

if (!request) {
  log('No request provided. Use args to specify the task.')
  return { error: 'No request', tasksCompleted: 0 }
}

// --- Phase 1: Assistant ---
phase('Assistant')

const tasksMdPath = findTasksMd()

let assistantPrompt = `You are the assistant for a development team.\n` +
  `Gather current project context from CLAUDE.md and recent git commits.\n`

// Obsidian tasks.md を読み込む
try {
  const fs = require('fs')
  if (fs.existsSync(tasksMdPath)) {
    const tasksContent = fs.readFileSync(tasksMdPath, 'utf-8')
    // [ ] で始まる未完了タスクのみ抽出
    const uncompletedTasks = tasksContent
      .split('\n')
      .filter(line => line.trim().startsWith('- [ ]') || line.trim().startsWith('• [ ]'))
      .slice(0, 20) // 最大20件に制限
      .map(line => line.replace(/^[-•]\s*\[ \]\s*/, '').trim())
      .join('\n')
    assistantPrompt += `\n\nUNCOMPLETED TASKS (from ${tasksMdPath}):\n${uncompletedTasks}\n\n` +
      `IMPORTANT: Prioritize these uncompleted tasks when generating implementation plans.`
  }
} catch (e) {
  log(`Warning: Could not read tasks.md at ${tasksMdPath}: ${e.message}`)
}

assistantPrompt += `\n\nThe request is: "${request}"\n\n` +
  'Return only what\'s relevant to this request.'

const assistantResult = await agent(assistantPrompt, { label: 'assistant', phase: 'Assistant', schema: ASSISTANT_SCHEMA, effort: 'max' })

const ctx = assistantResult?.summary || ''
log(`Assistant context (${ctx.length} chars): ${ctx.slice(0, 120)}...`)

// --- Phase 2: Plan ---
phase('Plan')

const planResult = await agent(
  `You are a technical planner.\n` +
  `Project context: ${ctx}\n\n` +
  `Request: "${request}"\n\n` +
  `Create detailed per-file task specs. Each file instruction must be <500 chars and specific.\n` +
  `DO NOT read source files — use only the context above and CLAUDE.md patterns.\n` +
  'Return a JSON object matching PLAN_SCHEMA with taskSpecs[].',
  { label: 'planner', phase: 'Plan', schema: PLAN_SCHEMA, effort: 'max' },
)

const taskSpecs = planResult?.taskSpecs || []
if (!taskSpecs.length) {
  log('ERROR: Planner returned no tasks. Aborting.')
  return { error: 'No tasks generated', tasksCompleted: 0 }
}

log(`Planner generated ${taskSpecs.length} task specs.`)

// --- Phase 3: Program ---
phase('Program')

const subtasks = splitIntoSubtasks(taskSpecs)
if (!subtasks.length) {
  log('ERROR: No file-level subtasks from plan. Aborting.')
  return { error: 'No subtasks', tasksCompleted: 0 }
}

log(`Split into ${subtasks.length} file-level subtasks.`)

const MAX_PARALLEL = 4
const completed = []

for (let i = 0; i < subtasks.length; i += MAX_PARALLEL) {
  const batch = subtasks.slice(i, i + MAX_PARALLEL)
  const results = await parallel(
    batch.map((subtask, idx) => () =>
      agent(buildProgrammerPrompt(subtask), {
        label: `programmer-${i + idx} [${subtask.path.split('/').pop()}]`,
        phase: 'Program',
        effort: 'max',
      })
    ),
  )

  for (const result of results) {
    if (result) completed.push(result)
  }
}

log(`Completed ${completed.length} programming tasks.`)

// --- Phase 4: Verify ---
phase('Verify')

const verifyResult = await agent(
  'Run the following commands to verify the changes:\n' +
  '1. pnpm run check (svelte-check)\n' +
  '2. cargo check\n' +
  '3. If tests exist, run: pnpm test\n\n' +
  'Report whether all checks pass and list any issues found.\n' +
  'If a step fails, explain why and suggest a fix.',
  { label: 'verifier', phase: 'Verify', schema: VERIFICATION_SCHEMA, effort: 'max' },
)

const passed = verifyResult?.passed ?? false
const issues = verifyResult?.issues || []
log(`Verification ${passed ? 'PASSED' : 'FAILED'} with ${issues.length} issues.`)

// --- Phase 5: Document ---
phase('Document')

const docResult = await agent(
  'Update CLAUDE.md or relevant documentation files to reflect the changes made in this session.\n' +
  `Implementation summary:\n${completed.join('\n---\n').slice(0, 3000)}\n\n` +
  'Keep updates minimal and focused. Return what you documented.',
  { label: 'documenter', phase: 'Document', schema: DOC_SCHEMA, effort: 'max' },
)

log(`Documentation ${docResult?.updated ? 'updated' : 'not needed'}: ${docResult?.summary || 'N/A'}`)

// --- Phase 6: Retrospective ---
phase('Retrospective')

const retroResult = await agent(
  'Review this development cycle and provide a retrospective.\n\n' +
  `Tasks completed: ${completed.length}\n` +
  `Verification passed: ${passed}\n` +
  `Issues found: ${issues.length}\n\n` +
  'What worked well? What failed? What should we improve next cycle?',
  { label: 'retrospective', phase: 'Retrospective', schema: RETRO_SCHEMA, effort: 'max' },
)

// ========== RESULT REPORT ==========

const actionItems = retroResult?.actionItems || []

return {
  tasksCompleted: completed.length,
  verificationPassed: passed,
  issuesFound: issues.length,
  implementation: completed.map((c) => c.slice(0, 500)),
  retrospective: {
    worked: retroResult?.whatWorked || [],
    failed: retroResult?.whatFailed || [],
    improvements: actionItems,
  },
}
