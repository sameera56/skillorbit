import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('generates dynamic LaTeX, escapes special characters, and omits empty sections', () => {
  const moduleUrl = new URL('../src/resume-latex.ts', import.meta.url).href
  const resume = {
    title: 'Developer resume',
    content: {
      fullName: 'Alex & #1_50% {R&D} \\ Test ~ ^',
      email: 'alex_dev@example.test',
      phone: '555$123',
      summary: 'Build tools & improve reliability.',
      skills: ['Languages: C#, TypeScript', 'Tools: Git'],
      experience: ['Engineer at A&B'],
      projects: ['Project #1'],
      education: [],
      certifications: [],
    },
  }
  const script = `import { generateResumeLatex } from ${JSON.stringify(moduleUrl)}; process.stdout.write(generateResumeLatex(${JSON.stringify(resume)}))`
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const latex = result.stdout

  assert.match(latex, /\\documentclass\[10pt,letterpaper\]\{article\}/)
  assert.match(latex, /\\begin\{document\}/)
  assert.match(latex, /\\end\{document\}/)
  assert.match(latex, /Alex \\& \\#1\\_50\\% \\{R\\&D\\} \\textbackslash\{\} Test \\textasciitilde\{\} \\textasciicircum\{\}/)
  assert.match(latex, /\\section\*\{Technical Skills\}/)
  assert.match(latex, /\\textbf\{Languages:\} C\\\#, TypeScript/)
  assert.match(latex, /\\section\*\{Work Experience\}/)
  assert.match(latex, /\\section\*\{Projects\}/)
  assert.match(latex, /alex\\_dev@example\.test/)
  assert.match(latex, /555\\\$123/)
  assert.doesNotMatch(latex, /\\section\*\{Education\}/)
  assert.doesNotMatch(latex, /\\section\*\{Certifications\}/)

  const begins = [...latex.matchAll(/\\begin\{([^}]+)\}/g)].map((match) => match[1])
  const ends = [...latex.matchAll(/\\end\{([^}]+)\}/g)].map((match) => match[1])
  assert.deepEqual(ends.sort(), begins.sort())
})

test('creates a safe TeX download filename', async () => {
  const moduleUrl = new URL('../src/resume-latex.ts', import.meta.url).href
  const script = `import { resumeLatexFilename } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify([resumeLatexFilename('R&D Resume'), resumeLatexFilename('***')]))`
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), ['r-d-resume.tex', 'resume.tex'])
})

test('preserves intentionally blank contact fields and fills legacy resumes from the owner profile', async () => {
  const moduleUrl = new URL('../src/resume-latex.ts', import.meta.url).href
  const script = `import { getResumeContact } from ${JSON.stringify(moduleUrl)}; const owner = { email: 'owner@example.test', profile: { fullName: 'Profile Name', phone: '555-1234' } }; process.stdout.write(JSON.stringify([getResumeContact({ title: 'Resume', content: { fullName: '', email: '', phone: '' } }, owner), getResumeContact({ title: 'Resume', content: {} }, owner)]))`
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [
    { fullName: '', email: '', phone: '' },
    { fullName: 'Profile Name', email: 'owner@example.test', phone: '555-1234' },
  ])
})
