export type LatexResume = { title: string; content: Record<string, unknown> }
export type ResumeOwner = { email?: string; profile?: Record<string, unknown> }

export function resumeLatexFilename(title: string): string {
  const slug = title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'resume'
  return `${slug}.tex`
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

export function getResumeContact(resume: LatexResume, owner: ResumeOwner = {}): { fullName: string; email: string; phone: string } {
  const content = resume.content
  const profile = owner.profile || {}
  const value = (key: string, fallback: string) => Object.prototype.hasOwnProperty.call(content, key) ? text(content[key]) : fallback
  const ownerEmail = text(owner.email)
  return {
    fullName: value('fullName', text(profile.fullName) || ownerEmail.split('@')[0] || text(resume.title) || 'Resume'),
    email: value('email', ownerEmail),
    phone: value('phone', text(profile.phone)),
  }
}

function escapeLatex(value: string): string {
  const escaped: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    '$': '\\$',
    '#': '\\#',
    '_': '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  }
  return value.replace(/[\\&%$#_{}~^]/g, (character) => escaped[character])
}

export function resumeItems(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return source.flatMap((entry) => String(entry).split(/\r?\n/)).map((entry) => entry.trim()).filter(Boolean)
}

export function groupResumeSkills(value: unknown): { category: string; skills: string[] }[] {
  const ungrouped: string[] = []
  const grouped: { category: string; skills: string[] }[] = []
  for (const entry of resumeItems(value)) {
    const separator = entry.indexOf(':')
    if (separator > 0) {
      const category = entry.slice(0, separator).trim()
      const skills = entry.slice(separator + 1).split(',').map((skill) => skill.trim()).filter(Boolean)
      if (category && skills.length) grouped.push({ category, skills })
    } else {
      ungrouped.push(...entry.split(',').map((skill) => skill.trim()).filter(Boolean))
    }
  }
  return [...(ungrouped.length ? [{ category: 'Skills', skills: ungrouped }] : []), ...grouped]
}

function itemSection(title: string, values: string[]): string {
  if (!values.length) return ''
  return [
    `\\section*{${title}}`,
    '\\begin{itemize}',
    ...values.map((value) => `  \\item ${escapeLatex(value)}`),
    '\\end{itemize}',
    '',
  ].join('\n')
}

export function generateResumeLatex(resume: LatexResume, owner: ResumeOwner = {}): string {
  const content = resume.content
  const { fullName, email, phone } = getResumeContact(resume, owner)
  const contact = [email, phone].filter(Boolean).map(escapeLatex).join(' \\textbar{} ')
  const summary = text(content.summary)
  const summaryParagraphs = summary
    ? summary.split(/\r?\n\s*\r?\n/).map((paragraph) => escapeLatex(paragraph.replace(/\r?\n/g, ' '))).filter(Boolean).join('\n\\par\n')
    : ''
  const skills = groupResumeSkills(content.skills)
  const skillSection = skills.length
    ? `\\section*{Technical Skills}\n${skills.map(({ category, skills: values }) => `\\textbf{${escapeLatex(category)}:} ${values.map(escapeLatex).join(', ')}\\par`).join('\n')}\n`
    : ''

  return [
    '\\documentclass[10pt,letterpaper]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{textcomp}',
    '\\usepackage{lmodern}',
    '\\usepackage[margin=0.75in]{geometry}',
    '\\usepackage{xcolor}',
    '\\usepackage{enumitem}',
    '\\usepackage{titlesec}',
    '\\definecolor{SkillOrbitTeal}{HTML}{137C72}',
    '\\titleformat{\\section}{\\large\\bfseries\\color{SkillOrbitTeal}}{}{0em}{}[\\titlerule]',
    '\\titlespacing*{\\section}{0pt}{11pt}{5pt}',
    '\\setlist[itemize]{leftmargin=1.2em,itemsep=2pt,topsep=3pt,parsep=0pt}',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\parskip}{3pt}',
    '\\pagestyle{empty}',
    '\\begin{document}',
    '\\begin{center}',
    fullName ? `{\\LARGE\\bfseries ${escapeLatex(fullName)}}\\\\[3pt]` : '',
    contact ? `{\\small ${contact}}` : '',
    '\\end{center}',
    summaryParagraphs ? `\\section*{Professional Summary}\n${summaryParagraphs}\n` : '',
    skillSection,
    itemSection('Work Experience', resumeItems(content.experience)),
    itemSection('Projects', resumeItems(content.projects)),
    itemSection('Education', resumeItems(content.education)),
    itemSection('Certifications', resumeItems(content.certifications)),
    '\\end{document}',
    '',
  ].filter((line) => line !== '').join('\n')
}
