import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, Bell, BookOpen, BriefcaseBusiness, Building2, Eye,
  Check, ChevronDown, CircleHelp, FileText, GraduationCap, LayoutDashboard,
  LogOut, Menu, MessageSquareText, Plus, RefreshCw, Search, Settings2, Sparkles, Target,
  Trash2, Users, X,
} from 'lucide-react'
import { generateResumeLatex, getResumeContact, groupResumeSkills, resumeItems, resumeLatexFilename } from './resume-latex'
import './App.css'

type Role = 'student' | 'institution' | 'company'
type RegistrationRole = 'student' | 'company'
type User = { id: number; email: string; role: Role; profile: Record<string, unknown> }
type ApplicantDetails = { fullName: string; email: string; phone: string }
type Job = { id: number; title: string; company?: string; domain: string; location: string; type: string; salary?: string; description?: string; requirements?: string; deadline?: string | null; status?: string; applicants?: number }
type Resume = { id: number; title: string; content: Record<string, unknown>; updatedAt?: string }
type JobAlert = { id: number; keyword: string; domain: string; location: string; type: string; createdAt?: string }
type HiringStatus = 'interested' | 'applied' | 'shortlisted' | 'assessment' | 'interview' | 'selected' | 'rejected'
type CompanyOverviewData = {
  jobs: { total: number; open: number }
  applications: { total: number; shortlisted: number; interview: number; selected: number }
  pipeline: Record<HiringStatus, number>
  recentApplicants: { applicationId: number; status: HiringStatus; appliedAt: string; jobTitle: string; fullName: string }[]
  jobsNeedingAttention: { id: number; title: string; deadline: string | null; applicants: number; recentApplicants: number; deadlinePassed: boolean; closingSoon: boolean }[]
}
type CompanyApplicant = {
  applicationId: number
  status: HiringStatus
  appliedAt: string
  studentId: number
  email: string
  jobTitle: string
  jobId: number
  coverLetter: string
  resumeName: string
  profile: Record<string, unknown>
  history: { oldStatus: string | null; newStatus: string; createdAt: string }[]
}
type Question = { id: number; topic: string; prompt: string; options: string[] }
type Notice = { tone: 'success' | 'error' | 'info'; text: string; link?: string }
type PageKey = 'overview' | 'profile' | 'resumes' | 'ats' | 'jobs' | 'saved' | 'jobAlerts' | 'applications' | 'practice' | 'aptitude' | 'experiences' | 'guidance' | 'students' | 'departments' | 'drives' | 'reports' | 'companyJobs' | 'applicants' | 'applicantDetails'
type PageRefreshDetail = { waitUntil: (promise: Promise<unknown>) => void }
const PAGE_REFRESH_EVENT = 'skillorbit:refresh-page'
const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const apiUrl = (path: string) => `${API_BASE}${path}`

function usePageRefresh(refresh: () => void | Promise<unknown>) {
  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<PageRefreshDetail>).detail
      detail.waitUntil(Promise.resolve(refresh()))
    }
    window.addEventListener(PAGE_REFRESH_EVENT, handleRefresh)
    return () => window.removeEventListener(PAGE_REFRESH_EVENT, handleRefresh)
  }, [refresh])
}

const pageTitles: Record<PageKey, string> = {
  overview: 'Overview', profile: 'My profile', resumes: 'Resume builder', ats: 'Resume analysis',
  jobs: 'Explore opportunities', saved: 'Saved jobs', jobAlerts: 'Job alerts', applications: 'Applications',
  practice: 'Interview practice', aptitude: 'Aptitude practice', experiences: 'Interview stories',
  guidance: 'Career guidance', students: 'Student directory', departments: 'Departments',
  drives: 'Placement drives', reports: 'Reports', companyJobs: 'Job postings', applicants: 'Applicants', applicantDetails: 'Applicant details',
}

const navigation: Record<Role, { key: PageKey; label: string; icon: typeof LayoutDashboard }[]> = {
  student: [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'profile', label: 'My profile', icon: Users },
    { key: 'resumes', label: 'Resume builder', icon: FileText },
    { key: 'ats', label: 'Resume analysis', icon: Target },
    { key: 'jobs', label: 'Find opportunities', icon: BriefcaseBusiness },
    { key: 'saved', label: 'Saved jobs', icon: Check },
    { key: 'jobAlerts', label: 'Job alerts', icon: Bell },
    { key: 'applications', label: 'Applications', icon: Activity },
    { key: 'aptitude', label: 'Aptitude practice', icon: CircleHelp },
    { key: 'practice', label: 'Interview practice', icon: MessageSquareText },
    { key: 'experiences', label: 'Interview stories', icon: BookOpen },
    { key: 'guidance', label: 'Career guidance', icon: Sparkles },
  ],
  institution: [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'profile', label: 'Institution profile', icon: Building2 },
    { key: 'students', label: 'Students', icon: Users },
    { key: 'departments', label: 'Departments', icon: GraduationCap },
    { key: 'drives', label: 'Placement drives', icon: BriefcaseBusiness },
    { key: 'reports', label: 'Reports', icon: ArrowDownToLine },
  ],
  company: [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'profile', label: 'Company profile', icon: Building2 },
    { key: 'companyJobs', label: 'Job postings', icon: BriefcaseBusiness },
    { key: 'applicants', label: 'Applicants', icon: Users },
    { key: 'reports', label: 'Reports', icon: ArrowDownToLine },
  ],
}

const routes: Record<Role, Partial<Record<PageKey, string>>> = {
  student: {
    overview: '/dashboard', profile: '/dashboard/profile', resumes: '/dashboard/resume-builder',
    ats: '/dashboard/resume-ats', jobs: '/dashboard/jobs', saved: '/dashboard/saved-jobs',
    applications: '/dashboard/applications', jobAlerts: '/dashboard/job-alerts', aptitude: '/dashboard/aptitude',
    practice: '/dashboard/interview-practice', experiences: '/dashboard/interview-experience',
    guidance: '/dashboard/career-guidance',
  },
  institution: {
    overview: '/dashboard/institution', profile: '/dashboard/institution/profile',
    students: '/dashboard/institution/students', departments: '/dashboard/institution/departments',
    drives: '/dashboard/institution/placement-drives', reports: '/dashboard/institution/reports',
  },
  company: {
    overview: '/dashboard/company', profile: '/dashboard/company/profile',
    companyJobs: '/dashboard/company/my-jobs', applicants: '/dashboard/company/applicants',
    reports: '/dashboard/company/reports',
  },
}

function pageForPath(userRole: Role, pathname: string): PageKey {
  if (userRole === 'company' && applicantIdFromPath(pathname) !== null) return 'applicantDetails'
  return (Object.entries(routes[userRole]).find(([, route]) => route === pathname)?.[0] as PageKey | undefined) || 'overview'
}

function applicantIdFromPath(pathname: string): number | null {
  const match = /^\/dashboard\/company\/applicants\/(\d+)$/.exec(pathname)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function roleFromPath(pathname: string): RegistrationRole {
  const match = /^\/register\/(student|company)$/.exec(pathname)
  return match ? match[1] as RegistrationRole : 'student'
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('skillorbit-token')
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(apiUrl(url), { ...init, headers })
  if (response.status === 401 && token) {
    sessionStorage.removeItem('skillorbit-token')
    sessionStorage.removeItem('skillorbit-user')
    window.dispatchEvent(new Event('skillorbit-session-expired'))
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({})) as { message?: string }
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status}).`)
  return payload as T
}

function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) }
}

function safeUser(): User | null {
  try {
    const stored = sessionStorage.getItem('skillorbit-user')
    return stored ? JSON.parse(stored) as User : null
  } catch {
    sessionStorage.removeItem('skillorbit-user')
    return null
  }
}

function displayName(user: User) {
  const profile = user.profile
  return String(profile.fullName || profile.institutionName || profile.companyName || user.email.split('@')[0])
}

function downloadResume(resume: Resume, user: User) {
  const latex = generateResumeLatex(resume, user)
  const url = URL.createObjectURL(new Blob([latex], { type: 'application/x-tex;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = resumeLatexFilename(resume.title)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
  const [user, setUser] = useState<User | null>(safeUser)
  const [page, setPage] = useState<PageKey>(() => {
    const stored = safeUser()
    return stored ? pageForPath(stored.role, window.location.pathname) : 'overview'
  })
  const [selectedApplicantId, setSelectedApplicantId] = useState<number | null>(() => applicantIdFromPath(window.location.pathname))
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>(() => window.location.pathname.startsWith('/register') ? 'register' : 'login')
  const [authRole, setAuthRole] = useState<RegistrationRole>(() => roleFromPath(window.location.pathname))

  const notify = useCallback((text: string, tone: Notice['tone'] = 'success') => {
    setNotice({ text, tone })
    window.setTimeout(() => setNotice(null), 4200)
  }, [])

  const onAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const authForm = event.currentTarget
    const form = new FormData(authForm)
    const body: Record<string, unknown> = {
      email: String(form.get('email') || '').trim(),
      password: String(form.get('password') || ''),
    }
    if (authMode === 'register') {
      if (authRole === 'student') Object.assign(body, { fullName: form.get('name'), university: form.get('university'), department: form.get('department') })
      if (authRole === 'company') Object.assign(body, { companyName: form.get('name'), industry: form.get('industry'), website: form.get('website') })
    }
    setBusy(true)
    try {
      const path = authMode === 'login' ? '/api/auth/login' : `/api/auth/register/${authRole}`
      const result = await request<{ token?: string; user?: User; message?: string }>(path, jsonBody(body))
      if (authMode === 'register') {
        authForm.reset()
        setAuthMode('login')
        window.history.replaceState(null, '', '/auth')
        setNotice({ text: result.message || 'Account created. You can sign in now.', tone: 'success' })
        return
      }
      if (!result.token || !result.user) throw new Error('Sign-in response was incomplete. Please try again.')
      sessionStorage.setItem('skillorbit-token', result.token)
      sessionStorage.setItem('skillorbit-user', JSON.stringify(result.user))
      setUser(result.user)
      setPage('overview')
      setSelectedApplicantId(null)
      window.history.replaceState(null, '', routes[result.user.role].overview || '/dashboard')
      notify('Welcome back.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not sign in.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const signOut = () => {
    sessionStorage.removeItem('skillorbit-token')
    sessionStorage.removeItem('skillorbit-user')
    setUser(null)
    setPage('overview')
    setSelectedApplicantId(null)
    setMenuOpen(false)
    setAuthMode('login')
    window.history.pushState(null, '', '/auth')
  }

  const navigate = (next: PageKey) => {
    setPage(next)
    setSelectedApplicantId(null)
    setMenuOpen(false)
    window.history.pushState(null, '', routes[user?.role || 'student'][next] || '/dashboard')
  }
  const openApplicant = (applicationId: number) => {
    if (user?.role !== 'company' || !Number.isSafeInteger(applicationId) || applicationId < 1) return
    setPage('applicantDetails')
    setSelectedApplicantId(applicationId)
    setMenuOpen(false)
    window.history.pushState(null, '', `/dashboard/company/applicants/${applicationId}`)
  }

  useEffect(() => {
    const handleExpired = () => setUser(null)
    const handlePopState = () => {
      const current = safeUser()
      if (current) {
        setPage(pageForPath(current.role, window.location.pathname))
        setSelectedApplicantId(applicantIdFromPath(window.location.pathname))
      }
      else {
        setSelectedApplicantId(null)
        setAuthMode(window.location.pathname.startsWith('/register') ? 'register' : 'login')
        setAuthRole(roleFromPath(window.location.pathname))
      }
    }
    window.addEventListener('skillorbit-session-expired', handleExpired)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('skillorbit-session-expired', handleExpired)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back()
    })
    return () => { void listener.then((handle) => handle.remove()) }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  useEffect(() => {
    if (!user) return
    const route = page === 'applicantDetails' && user.role === 'company' && selectedApplicantId
      ? `/dashboard/company/applicants/${selectedApplicantId}`
      : routes[user.role][page] || routes[user.role].overview || '/dashboard'
    if (window.location.pathname !== route) window.history.replaceState(null, '', route)
  }, [page, user, selectedApplicantId])

  const changeAuthMode = (mode: 'login' | 'register') => {
    setAuthMode(mode)
    window.history.pushState(null, '', mode === 'login' ? '/auth' : `/register/${authRole}`)
  }
  const changeAuthRole = (role: RegistrationRole) => {
    setAuthRole(role)
    if (authMode === 'register') window.history.replaceState(null, '', `/register/${role}`)
  }
  if (!user && window.location.pathname === '/') {
    return <LandingPage onLogin={() => changeAuthMode('login')} onRegister={() => changeAuthMode('register')} />
  }
  if (!user) {
    return <AuthPage mode={authMode} role={authRole} busy={busy} onSubmit={onAuth} onMode={changeAuthMode} onRole={changeAuthRole} notice={notice} />
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside id="workspace-navigation" className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Sparkles size={20} /></div><span>SkillOrbit</span></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation[user.role].map(({ key, label, icon: Icon }) => {
            const active = page === key || (page === 'applicantDetails' && key === 'applicants')
            return <button type="button" className={`nav-item ${active ? 'active' : ''}`} key={key} aria-current={active ? 'page' : undefined} onClick={() => navigate(key)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </button>
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-mini"><div className="avatar">{displayName(user).slice(0, 1).toUpperCase()}</div><div className="user-mini-copy"><strong>{displayName(user)}</strong><span>{user.role}</span></div><ChevronDown size={16} /></div>
          <button type="button" className="nav-item signout" onClick={signOut}><LogOut size={18} /><span>Sign out</span></button>
        </div>
      </aside>
      {menuOpen && <button type="button" className="mobile-backdrop" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)} />}
      <main id="main-content" className="main-area" tabIndex={-1}>
        <header className="topbar">
          <button className="icon-button mobile-menu" type="button" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-controls="workspace-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>{user.role === 'student' ? 'Student workspace' : user.role === 'company' ? 'Company workspace' : 'Institution workspace'}</span><span className="crumb-slash">/</span><strong>{pageTitles[page]}</strong></div>
          <div className="topbar-right"><span className="status-dot" /><span className="workspace-status">Your workspace is up to date</span><NotificationBell navigate={navigate} /><div className="avatar top-avatar">{displayName(user).slice(0, 1).toUpperCase()}</div></div>
        </header>
        <div className="page-content">
          <PageContent user={user} page={page} navigate={navigate} openApplicant={openApplicant} applicantId={selectedApplicantId} notify={notify} onUserUpdate={setUser} />
        </div>
      </main>
      {notice && <div className={`toast toast-${notice.tone}`} role="status">{notice.tone === 'success' ? <Check size={17} /> : <CircleHelp size={17} />}{notice.text}<button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    </div>
  )
}

function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return <div className="landing-page">
    <header className="landing-header"><a className="brand" href="/" aria-label="SkillOrbit home"><span className="brand-mark"><Sparkles size={20} /></span><span>SkillOrbit</span></a>
      <nav className="landing-nav" aria-label="Public navigation"><a href="#how-it-works">How it works</a><a href="#for-everyone">For everyone</a></nav>
      <div className="landing-actions"><button className="landing-login" onClick={onLogin}>Sign in</button><button className="primary-button" onClick={onRegister}>Get started <ArrowRight size={16} /></button></div>
    </header>
    <main>
      <section className="landing-hero"><div className="landing-hero-copy"><span className="landing-eyebrow"><span /> CAREER READINESS, CONNECTED</span><h1>Your next chapter<br />starts <em>right here.</em></h1><p>One connected workspace for students building their future, institutions guiding talent, and companies finding their next great hire.</p><div className="landing-hero-actions"><button className="primary-button landing-cta" onClick={onRegister}>Start your journey <ArrowRight size={17} /></button><button className="landing-secondary" onClick={onLogin}>I already have an account</button></div><div className="landing-trust"><span className="trust-avatars"><b>S</b><b>I</b><b>C</b></span><span>Built for every step from learning to landing the role.</span></div></div>
        <div className="landing-visual" aria-label="A snapshot of the SkillOrbit career workspace"><div className="visual-orbit orbit-one"/><div className="visual-orbit orbit-two"/><div className="visual-glow"/><div className="visual-card visual-main"><div className="visual-card-top"><span className="visual-icon"><Activity size={17}/></span><span><b>Your career journey</b><small>Everything moving forward</small></span><span className="visual-live">● LIVE</span></div><div className="visual-progress"><span/></div><div className="visual-steps"><span className="done">Discover</span><span className="done">Prepare</span><span>Connect</span><span>Grow</span></div></div><div className="visual-card visual-job"><span className="visual-job-icon"><BriefcaseBusiness size={17}/></span><span><b>Product Designer</b><small>New opportunity · Remote</small></span><span className="visual-arrow"><ArrowRight size={16}/></span></div><div className="visual-card visual-score"><span className="score-ring">86<small>%</small></span><span><b>Profile strength</b><small>Looking good</small></span></div><span className="visual-spark spark-a">✦</span><span className="visual-spark spark-b">✧</span></div></section>
      <section id="for-everyone" className="landing-audience"><div className="audience-heading"><span className="landing-eyebrow">A BETTER WAY TO MOVE FORWARD</span><h2>Every career journey, <em>in one place.</em></h2><p>Purpose-built tools bring the right people together at every stage.</p></div><div className="audience-grid"><article><span className="audience-icon student-icon"><GraduationCap size={20}/></span><span className="audience-kicker">FOR STUDENTS</span><h3>Build skills. Find your fit.</h3><p>Shape your resume, practice interviews, discover opportunities, and keep applications on track.</p><button onClick={onRegister}>Explore student tools <ArrowRight size={15}/></button></article><article><span className="audience-icon institution-icon"><Building2 size={20}/></span><span className="audience-kicker">FOR INSTITUTIONS</span><h3>Turn potential into placement.</h3><p>Organize student rosters, departments, placement drives, and campus outcomes in one workspace.</p><button onClick={onLogin}>Institution sign in <ArrowRight size={15}/></button></article><article><span className="audience-icon company-icon"><Users size={20}/></span><span className="audience-kicker">FOR COMPANIES</span><h3>Meet talent ready to grow.</h3><p>Post roles, review applicants, manage hiring pipelines, and understand your recruiting progress.</p><button onClick={onRegister}>Explore hiring tools <ArrowRight size={15}/></button></article></div></section>
      <section id="how-it-works" className="landing-bottom-cta"><div><span className="landing-eyebrow">YOUR NEXT STEP IS CLOSER</span><h2>Make your next move<br/><em>your best one.</em></h2></div><button className="primary-button landing-cta" onClick={onRegister}>Create your free account <ArrowRight size={17}/></button></section>
    </main><footer className="landing-footer"><a className="brand" href="/" aria-label="SkillOrbit home"><span className="brand-mark"><Sparkles size={17}/></span><span>SkillOrbit</span></a><span>Career-ready, together.</span><span>© 2026 SkillOrbit</span></footer>
  </div>
}

function NotificationBell({ navigate }: { navigate: (page: PageKey) => void }) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<{ id: number; kind: string; title: string; detail: string; readAt: string | null; createdAt: string }[]>([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    request<{ notifications: typeof notifications; unread: number }>('/api/notifications')
      .then((result) => { setNotifications(result.notifications); setUnread(result.unread); setError('') })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load notifications.'))
  }, [open])
  const select = async (item: typeof notifications[number]) => {
    if (!item.readAt) {
      try {
        await request(`/api/notifications/${item.id}`, { method: 'PATCH' })
        setNotifications((current) => current.map((notice) => notice.id === item.id ? { ...notice, readAt: new Date().toISOString() } : notice))
        setUnread((count) => Math.max(0, count - 1))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not update notification.')
        return
      }
    }
    navigate(item.kind === 'application' ? (safeUser()?.role === 'company' ? 'applicants' : 'applications') : item.kind === 'job' ? 'jobs' : 'overview')
    setOpen(false)
  }
  return <div className="notification-wrap">
    <button className="icon-button notification-button" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}><Bell size={18} />{unread > 0 && <span className="notification-count">{unread > 9 ? '9+' : unread}</span>}</button>
    {open && <><button className="notification-dismiss" aria-label="Close notifications" onClick={() => setOpen(false)} /><div className="notification-panel"><div className="notification-heading"><div><strong>Notifications</strong><small>{unread ? `${unread} unread` : 'You’re all caught up'}</small></div><button className="icon-button" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button></div>
      {error ? <ErrorState message={error} /> : notifications.length ? <div className="notification-list">{notifications.map((item) => <button className={`notification-item ${item.readAt ? '' : 'unread'}`} key={item.id} onClick={() => void select(item)}><span className="notification-mark"><Activity size={14} /></span><span><strong>{item.title}</strong><small>{item.detail}</small><small>{new Date(item.createdAt).toLocaleString()}</small></span></button>)}</div> : <div className="notification-empty">Updates about your account will appear here.</div>}
    </div></>}
  </div>
}

function AuthPage({ mode, role, busy, onSubmit, onMode, onRole, notice }: {
  mode: 'login' | 'register'; role: RegistrationRole; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onMode: (mode: 'login' | 'register') => void; onRole: (role: RegistrationRole) => void; notice: Notice | null
}) {
  const [email, setEmail] = useState('')
  const [actionMode, setActionMode] = useState<'reset' | null>(() => new URLSearchParams(window.location.search).has('reset') ? 'reset' : null)
  const actionToken = new URLSearchParams(window.location.search).get('reset') || ''
  const [actionBusy, setActionBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [actionLink, setActionLink] = useState('')
  const [newPassword, setNewPassword] = useState('')
  useEffect(() => {
    const verifyToken = new URLSearchParams(window.location.search).get('verify')
    if (!verifyToken) return
    request<{ message: string }>(`/api/auth/verify?token=${encodeURIComponent(verifyToken)}`)
      .then((result) => { setActionMessage(result.message); window.history.replaceState(null, '', '/auth') })
      .catch((cause: unknown) => setActionMessage(cause instanceof Error ? cause.message : 'Could not verify this email.'))
  }, [])
  const requestAccountLink = async () => {
    setActionBusy(true)
    setActionMessage('')
    setActionLink('')
    try {
      const result = await request<{ message: string; developmentLink?: string }>('/api/auth/forgot-password', jsonBody({ email }))
      setActionMessage(result.message)
      if (result.developmentLink) setActionLink(result.developmentLink)
    } catch (cause) { setActionMessage(cause instanceof Error ? cause.message : 'Could not send this email.') }
    finally { setActionBusy(false) }
  }
  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setActionBusy(true)
    setActionMessage('')
    try {
      const result = await request<{ message: string }>('/api/auth/reset-password', jsonBody({ token: actionToken, password: newPassword }))
      setActionMessage(result.message)
      setActionMode(null)
      setNewPassword('')
      window.history.replaceState(null, '', '/auth')
    } catch (cause) { setActionMessage(cause instanceof Error ? cause.message : 'Could not reset your password.') }
    finally { setActionBusy(false) }
  }
  return (
    <div className="auth-page">
      <a className="skip-link" href="#auth-main">Skip to sign-in form</a>
      <section className="auth-art">
        <div className="brand brand-light"><div className="brand-mark"><Sparkles size={20} /></div><span>SkillOrbit</span></div>
        <div className="art-copy"><div className="eyebrow"><span /> CAREER READINESS, CONNECTED</div><h1>Make your next move<br /><em>your best one.</em></h1><p>Build your profile, practice with purpose, and find opportunities that move you forward.</p>
          <div className="art-card"><div className="art-card-top"><span className="tiny-orb"><Target size={17} /></span><span>YOUR CAREER JOURNEY</span><span className="card-live">● LIVE</span></div><div className="journey-line"><span /><span /><span /><span /></div><div className="journey-labels"><span>Discover</span><span>Prepare</span><span>Connect</span><span>Grow</span></div></div>
        </div>
        <div className="art-footer"><span>Designed for your next chapter</span><span>01 — 04</span></div>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-brand"><div className="brand-mark"><Sparkles size={20} /></div> SkillOrbit</div>
        <div id="auth-main" className="auth-content" tabIndex={-1}>
          <div className="auth-heading"><div className="eyebrow">WELCOME {mode === 'login' ? 'BACK' : 'ABOARD'}</div><h2>{mode === 'login' ? 'Sign in to SkillOrbit' : 'Create your account'}</h2><p>{mode === 'login' ? 'Pick up right where your career journey left off.' : 'A few details, then you’re on your way.'}</p></div>
          <div className="auth-switch"><button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => { setActionMode(null); onMode('login') }}>Sign in</button><button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => { setActionMode(null); onMode('register') }}>Create account</button></div>
          {mode === 'register' && <div className="role-picker" aria-label="Account type">{(['student', 'company'] as RegistrationRole[]).map((value) => <button key={value} type="button" className={role === value ? 'chosen' : ''} onClick={() => onRole(value)}>{value === 'student' ? 'Student' : 'Company'}</button>)}</div>}
          {actionMode === 'reset' ? <form className="auth-form" onSubmit={(event) => void resetPassword(event)}><label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" /></label><button className="primary-button auth-submit" disabled={actionBusy}>{actionBusy ? 'Saving…' : 'Reset password'}<ArrowRight size={17} /></button><button type="button" className="text-button auth-action-button" onClick={() => { setActionMode(null); window.history.replaceState(null, '', '/auth') }}>Back to sign in</button></form>
            : <form className="auth-form" autoComplete="on" onSubmit={onSubmit}>
              {mode === 'register' && <label>{role === 'student' ? 'Full name' : role === 'company' ? 'Company name' : 'Institution name'}<input name="name" required maxLength={120} placeholder={role === 'student' ? 'Your name' : 'Organization name'} /></label>}
              {mode === 'register' && role === 'student' && <><label>University or college<input name="university" maxLength={160} placeholder="Where you study" /></label><label>Department<input name="department" maxLength={120} placeholder="Your field of study" /></label></>}
              {mode === 'register' && role === 'company' && <label>Industry<input name="industry" required maxLength={120} placeholder="e.g. Software" /></label>}
              {mode === 'register' && role !== 'student' && <label>Website <span className="optional">Optional</span><input name="website" type="url" maxLength={300} placeholder="https://" /></label>}
              <label>Email address<input name="email" type="email" required autoComplete={mode === 'login' ? 'username' : 'email'} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Password<input name="password" type="password" required minLength={mode === 'register' ? 8 : 1} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'} /></label>
              <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={17} /></button>
              {mode === 'login' && <div className="auth-account-actions"><button type="button" className="text-button" disabled={actionBusy} onClick={() => void requestAccountLink()}>Forgot password?</button></div>}
            </form>}
          {notice && <div className={`inline-notice ${notice.tone}`} role="status">{notice.text}{notice.link && <a href={notice.link}>Verify email</a>}</div>}
          {actionMessage && <div className="inline-notice info" role="status">{actionMessage}{actionLink && <a href={actionLink}>{actionLink.includes('reset=') ? 'Open password reset link' : 'Open verification link'}</a>}</div>}
          <p className="auth-privacy">By continuing, you agree to use SkillOrbit responsibly. Your account data stays associated with your role.</p>
        </div>
        <footer className="auth-bottom"><span>© 2026 SkillOrbit</span><span>Career-ready, together.</span></footer>
      </section>
    </div>
  )
}

function PageContent({ user, page, navigate, openApplicant, applicantId, notify, onUserUpdate }: { user: User; page: PageKey; navigate: (page: PageKey) => void; openApplicant: (applicationId: number) => void; applicantId: number | null; notify: (text: string, tone?: Notice['tone']) => void; onUserUpdate: (user: User) => void }) {
  const title = pageTitles[page]
  const [refreshing, setRefreshing] = useState(false)
  const refreshPage = async () => {
    if (refreshing) return
    setRefreshing(true)
    const pending: Promise<unknown>[] = []
    window.dispatchEvent(new CustomEvent<PageRefreshDetail>(PAGE_REFRESH_EVENT, { detail: { waitUntil: (promise) => pending.push(promise) } }))
    await Promise.allSettled(pending)
    setRefreshing(false)
  }
  const applicant: ApplicantDetails = {
    fullName: String(user.profile.fullName || ''),
    email: user.email,
    phone: String(user.profile.phone || ''),
  }
  return <div className="page-enter">
    <div className="page-heading"><div><div className="eyebrow">{user.role === 'student' ? 'YOUR CAREER JOURNEY' : user.role === 'company' ? 'TALENT WORKSPACE' : 'CAMPUS OPERATIONS'}</div><h1>{title}</h1><p>{pageDescription(page, user.role)}</p></div>
      <div className="page-heading-actions">
        <button className={`secondary-button page-refresh-button ${refreshing ? 'is-refreshing' : ''}`} type="button" onClick={() => void refreshPage()} disabled={refreshing} aria-label={`Refresh ${title}`} title={`Refresh ${title}`}><RefreshCw size={17} /></button>
        {page === 'jobs' && <button className="secondary-button" onClick={() => navigate('saved')}>Saved jobs <ArrowRight size={15} /></button>}
      </div>
    </div>
    {page === 'overview' && <Overview user={user} navigate={navigate} openApplicant={openApplicant} />}
    {page === 'profile' && <ProfilePage user={user} notify={notify} onUserUpdate={onUserUpdate} />}
    {page === 'resumes' && user.role === 'student' && <ResumePage user={user} notify={notify} />}
    {page === 'ats' && user.role === 'student' && <AtsPage notify={notify} />}
    {page === 'jobs' && user.role === 'student' && <JobsPage applicant={applicant} notify={notify} />}
    {page === 'saved' && user.role === 'student' && <SavedJobs applicant={applicant} notify={notify} />}
    {page === 'jobAlerts' && user.role === 'student' && <JobAlertsPage notify={notify} />}
    {page === 'applications' && user.role === 'student' && <ApplicationsPage notify={notify} />}
    {page === 'practice' && user.role === 'student' && <PracticePage mode="interview" notify={notify} />}
    {page === 'aptitude' && user.role === 'student' && <PracticePage mode="aptitude" notify={notify} />}
    {page === 'experiences' && user.role === 'student' && <ExperiencesPage notify={notify} />}
    {page === 'guidance' && user.role === 'student' && <GuidancePage />}
    {page === 'students' && user.role === 'institution' && <StudentsPage />}
    {page === 'departments' && user.role === 'institution' && <DepartmentsPage notify={notify} />}
    {page === 'drives' && user.role === 'institution' && <DrivesPage notify={notify} />}
    {page === 'reports' && user.role === 'institution' && <InstitutionReports />}
    {page === 'companyJobs' && user.role === 'company' && <CompanyJobs notify={notify} />}
    {page === 'applicants' && user.role === 'company' && <ApplicantsPage notify={notify} openApplicant={openApplicant} />}
    {page === 'applicantDetails' && user.role === 'company' && <ApplicantDetailPage applicationId={applicantId} navigate={navigate} notify={notify} />}
    {page === 'reports' && user.role === 'company' && <CompanyReports />}
  </div>
}

function pageDescription(page: PageKey, role: Role) {
  const descriptions: Partial<Record<PageKey, string>> = {
    overview: role === 'student' ? 'A clear view of your preparation and next steps.' : role === 'company' ? 'Track your job postings and candidate activity.' : 'See your institution’s current placement activity.',
    profile: 'Keep your account details accurate and up to date.',
    resumes: 'Create and manage resumes tailored to your goals.',
    ats: 'Compare a resume with a role description using transparent local analysis.',
    jobs: 'Explore opportunities from employers on SkillOrbit.',
    saved: 'Opportunities you bookmarked for later.',
    jobAlerts: 'Get an in-app notification when a new job matches your saved filters.',
    applications: 'See your application status and its history.',
    practice: 'Practice interview questions and reflect on your answers.',
    aptitude: 'Build confidence with focused practice questions.',
    experiences: 'Learn from interview stories shared by the community.',
    guidance: 'Explore practical next steps for a target role.',
    applicants: 'Review candidate profiles, resumes, and hiring progress.',
    applicantDetails: 'Review this candidate’s details, resume, and application progress.',
    students: 'Students who have associated their profile with your institution.',
    departments: 'Manage your institution’s department list.',
    drives: 'Record and track planned placement drives.',
    reports: 'Download reports generated from your current records.',
    companyJobs: 'Create, update, close, and manage your opportunities.',
  }
  return descriptions[page] || ''
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><strong>{title}</strong><p>{text}</p>{action}</div>
}

function Metric({ label, value, detail, icon: Icon, tone = 'mint' }: { label: string; value: string | number; detail: string; icon: typeof Activity; tone?: string }) {
  return <Card className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19} /></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></Card>
}

function Overview({ user, navigate, openApplicant }: { user: User; navigate: (page: PageKey) => void; openApplicant: (applicationId: number) => void }) {
  const [summary, setSummary] = useState<Record<string, unknown>>({})
  const [error, setError] = useState('')
  const load = useCallback(() => request<Record<string, unknown>>('/api/dashboard/summary')
    .then((result) => { setSummary(result); setError('') })
    .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load overview.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  if (error) return <ErrorState message={error} />
  if (user.role === 'student') {
    const activity = Array.isArray(summary.activity) ? summary.activity as { kind: string; detail: string; createdAt: string }[] : []
    return <>
      <div className="welcome-strip"><div className="welcome-copy"><span className="welcome-badge"><Sparkles size={14} /> LET’S MAKE PROGRESS</span><h2>One step at a time, {displayName(user).split(' ')[0]}.</h2><p>Your next opportunity starts with a little momentum.</p></div><button className="primary-button" onClick={() => navigate('jobs')}>Explore opportunities <ArrowRight size={16} /></button><div className="welcome-decoration">✳</div></div>
      <div className="metric-grid">
        <Metric label="Applications" value={Number(summary.applications || 0)} detail="Submitted by you" icon={BriefcaseBusiness} />
        <Metric label="Resumes" value={Number(summary.resumes || 0)} detail="Saved in your workspace" icon={FileText} tone="violet" />
        <Metric label="Practice sessions" value={Number(summary.practice || 0)} detail="Completed sessions" icon={Target} tone="peach" />
      </div>
      <div className="two-col-grid">
        <Card><SectionHeader title="Quick actions" sub="Pick up where you want to grow" /><div className="quick-actions">
          {[['Build your resume', 'Create or edit a resume', 'resumes', FileText], ['Practice for an interview', 'Answer a guided question', 'practice', MessageSquareText], ['Get career guidance', 'Choose your next step', 'guidance', Sparkles]].map(([heading, sub, target, Icon]) => {
            const ActionIcon = Icon as typeof FileText
            return <button key={String(target)} className="quick-action" onClick={() => navigate(target as PageKey)}><span className="quick-icon"><ActionIcon size={17} /></span><span><strong>{String(heading)}</strong><small>{String(sub)}</small></span><ArrowRight size={16} /></button>
          })}
        </div></Card>
        <Card><SectionHeader title="Recent activity" sub="Updates from your account" /><div className="activity-list">
          {activity.length ? activity.map((item, index) => <div className="activity-row" key={`${item.createdAt}-${index}`}><span className="activity-mark"><Activity size={15} /></span><span><strong>{item.detail}</strong><small>{item.kind} · {new Date(item.createdAt).toLocaleDateString()}</small></span></div>) : <div className="soft-empty"><span className="soft-empty-mark"><Sparkles size={17} /></span><div><strong>Your progress begins here</strong><small>Complete a profile, apply to a role, or start a practice session.</small></div></div>}
        </div></Card>
      </div>
    </>
  }
  if (user.role === 'company') return <CompanyOverview summary={summary} navigate={navigate} openApplicant={openApplicant} />
  return <InstitutionOverview summary={summary} navigate={navigate} />
}

function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return <div className="section-header"><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>{action}</div>
}

function CompanyOverview({ summary, navigate, openApplicant }: { summary: Record<string, unknown>; navigate: (page: PageKey) => void; openApplicant: (applicationId: number) => void }) {
  const [overview, setOverview] = useState<CompanyOverviewData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => {
    return request<CompanyOverviewData>('/api/company/overview')
      .then((result) => { setOverview(result); setError('') })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load hiring metrics.'))
      .finally(() => setLoading(false))
  }, [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const data = overview?.applications
  const pipelineStages: { key: HiringStatus; label: string }[] = [
    { key: 'interested', label: 'Interested' },
    { key: 'applied', label: 'Applied' },
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'interview', label: 'Interview' },
    { key: 'selected', label: 'Selected' },
    { key: 'rejected', label: 'Rejected' },
  ]
  const highestStageCount = Math.max(0, ...pipelineStages.map(({ key }) => overview?.pipeline[key] || 0))
  return <>
    <div className="welcome-strip company-welcome"><div className="welcome-copy"><span className="welcome-badge"><Building2 size={14} /> COMPANY WORKSPACE</span><h2>Find the people who move work forward.</h2><p>Keep opportunities current and stay close to your candidates.</p></div><button className="primary-button" onClick={() => navigate('companyJobs')}>Manage postings <ArrowRight size={16} /></button><div className="welcome-decoration">✳</div></div>
    <div className="metric-grid four">
      <Metric label="Job postings" value={overview?.jobs.total ?? Number(summary.jobs || 0)} detail={`${overview?.jobs.open ?? 0} open now`} icon={BriefcaseBusiness} />
      <Metric label="Applicants" value={data?.total ?? Number(summary.applicants || 0)} detail="Across your opportunities" icon={Users} tone="violet" />
      <Metric label="Shortlisted" value={data?.shortlisted ?? 0} detail="Ready for next steps" icon={Check} tone="peach" />
      <Metric label="Selected" value={data?.selected ?? 0} detail="Offers accepted or selected" icon={Target} tone="blue" />
    </div>
    {error && <ErrorState message={error} />}
    <Card><SectionHeader title="Hiring workspace" sub="Actions for your current hiring cycle" /><div className="action-grid"><button onClick={() => navigate('companyJobs')}><Plus size={18} /><strong>Post an opportunity</strong><span>Create a role and share what you're looking for.</span></button><button onClick={() => navigate('applicants')}><Users size={18} /><strong>Review applicants</strong><span>Search candidates and update their status.</span></button><button onClick={() => navigate('reports')}><ArrowDownToLine size={18} /><strong>Download report</strong><span>Export current job and application records.</span></button></div></Card>
    <div className="company-dashboard-grid">
      <Card className="company-dashboard-card">
        <SectionHeader title="Recent applicants" sub="Latest applications across your opportunities." action={<button className="text-button" type="button" onClick={() => navigate('applicants')}>View applicants <ArrowRight size={14} /></button>} />
        {loading ? <Loading /> : !error && overview?.recentApplicants.length ? <div className="company-dashboard-list">{overview.recentApplicants.map((applicant) => <button className="company-dashboard-row" type="button" key={applicant.applicationId} onClick={() => openApplicant(applicant.applicationId)} aria-label={`Review ${applicant.fullName}'s application for ${applicant.jobTitle}`}>
          <span className="dashboard-avatar">{applicant.fullName.slice(0, 1).toUpperCase()}</span><span className="dashboard-row-copy"><strong>{applicant.fullName}</strong><small>{applicant.jobTitle} · {new Date(applicant.appliedAt).toLocaleDateString()}</small></span><span className={`status-pill status-${applicant.status}`}>{applicant.status}</span>
        </button>)}</div> : !error ? <EmptyState title="No applicants yet" text="New applications will appear here." /> : null}
      </Card>
      <Card className="company-dashboard-card">
        <SectionHeader title="Hiring funnel" sub={`${data?.total ?? 0} application${data?.total === 1 ? '' : 's'} by current status; withdrawn applications are excluded.`} />
        {loading ? <Loading /> : !error && overview && <div className="hiring-pipeline" aria-label="Applications by current status">{pipelineStages.map(({ key, label }) => {
          const count = overview.pipeline[key]
          const width = highestStageCount ? `${Math.max(count ? 4 : 0, Math.round((count / highestStageCount) * 100))}%` : '0%'
          return <div className="pipeline-stage" key={key}><div className="pipeline-stage-label"><span>{label}</span><strong>{count}</strong></div><div className="pipeline-track" aria-hidden="true"><span className={`pipeline-fill pipeline-${key}`} style={{ width }} /></div></div>
        })}</div>}
      </Card>
    </div>
    <Card className="company-attention-card">
      <SectionHeader title="Jobs needing attention" sub="Open jobs closing soon or with applicants from the last 7 days." action={<button className="text-button" type="button" onClick={() => navigate('companyJobs')}>View postings <ArrowRight size={14} /></button>} />
      {loading ? <Loading /> : !error && overview?.jobsNeedingAttention.length ? <div className="attention-job-list">{overview.jobsNeedingAttention.map((job) => <button type="button" className="attention-job-row" key={job.id} onClick={() => navigate('companyJobs')} aria-label={`Manage ${job.title}`}>
        <span className="attention-job-icon"><BriefcaseBusiness size={17} /></span><span className="attention-job-copy"><strong>{job.title}</strong><small>{job.applicants} applicant{job.applicants === 1 ? '' : 's'} total</small></span><span className="attention-signals">{job.deadlinePassed && <span className="attention-signal urgent">Deadline passed</span>}{job.closingSoon && job.deadline && <span className="attention-signal">Closes {new Date(`${job.deadline}T00:00:00`).toLocaleDateString()}</span>}{job.recentApplicants > 0 && <span className="attention-signal new-applicants">{job.recentApplicants} new</span>}</span><ArrowRight size={15} />
      </button>)}</div> : !error ? <EmptyState title="All caught up" text="No open jobs are closing soon or have recent applications." /> : null}
    </Card>
  </>
}

function InstitutionOverview({ summary, navigate }: { summary: Record<string, unknown>; navigate: (page: PageKey) => void }) {
  const [metrics, setMetrics] = useState<{ students: number; applications: number; placed: number; departments: number } | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => request<typeof metrics>('/api/institution/analytics')
    .then((result) => { setMetrics(result); setError('') })
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load institutional metrics.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  return <>
    <div className="welcome-strip institution-welcome"><div className="welcome-copy"><span className="welcome-badge"><GraduationCap size={14} /> PLACEMENT OPERATIONS</span><h2>Build a clearer path from campus to career.</h2><p>Your metrics are computed from the students and records linked to your institution.</p></div><button className="primary-button" onClick={() => navigate('students')}>View students <ArrowRight size={16} /></button><div className="welcome-decoration">✳</div></div>
    <div className="metric-grid four">
      <Metric label="Students" value={metrics?.students ?? Number(summary.students || 0)} detail="Associated profiles" icon={Users} />
      <Metric label="Applications" value={metrics?.applications ?? '—'} detail="Across associated students" icon={BriefcaseBusiness} tone="violet" />
      <Metric label="Selected" value={metrics?.placed ?? '—'} detail="Current selected status" icon={Target} tone="peach" />
      <Metric label="Departments" value={metrics?.departments ?? Number(summary.departments || 0)} detail="Managed by your institution" icon={GraduationCap} tone="blue" />
    </div>
    {error && <ErrorState message={error} />}
    <Card><SectionHeader title="Placement operations" sub="Manage real records from your institution" /><div className="action-grid"><button onClick={() => navigate('departments')}><GraduationCap size={18} /><strong>Manage departments</strong><span>Add and maintain department names.</span></button><button onClick={() => navigate('drives')}><BriefcaseBusiness size={18} /><strong>Record a drive</strong><span>Track upcoming placement activity.</span></button><button onClick={() => navigate('reports')}><ArrowDownToLine size={18} /><strong>Export roster</strong><span>Download a CSV from linked student data.</span></button></div></Card>
  </>
}

function ErrorState({ message }: { message: string }) {
  return <div className="error-banner" role="alert"><CircleHelp size={18} /><span>{message}</span></div>
}

function ProfilePage({ user, notify, onUserUpdate }: { user: User; notify: (text: string, tone?: Notice['tone']) => void; onUserUpdate: (user: User) => void }) {
  const fields: Record<Role, { key: string; label: string; placeholder?: string }[]> = {
    student: [
      { key: 'fullName', label: 'Full name' }, { key: 'phone', label: 'Phone', placeholder: '10-digit Indian mobile number, e.g. 9876543210' }, { key: 'location', label: 'Location' },
      { key: 'university', label: 'University or college' }, { key: 'department', label: 'Department' }, { key: 'degree', label: 'Degree' },
      { key: 'graduationYear', label: 'Graduation year' }, { key: 'cgpa', label: 'GPA or CGPA' }, { key: 'skills', label: 'Skills', placeholder: 'Separate skills with commas' },
    ],
    institution: [
      { key: 'institutionName', label: 'Institution name' }, { key: 'phone', label: 'Phone' }, { key: 'location', label: 'Location' },
      { key: 'website', label: 'Website' }, { key: 'address', label: 'Address' }, { key: 'establishedYear', label: 'Established year' },
    ],
    company: [
      { key: 'companyName', label: 'Company name' }, { key: 'industry', label: 'Industry' }, { key: 'website', label: 'Website' },
      { key: 'location', label: 'Location' }, { key: 'phone', label: 'Phone' }, { key: 'contactName', label: 'Contact person' },
    ],
  }
  const profileValues = (profile: User['profile'], role: Role) => Object.fromEntries(fields[role].map((field) => [field.key, String(profile[field.key] ?? '')]))
  const [values, setValues] = useState<Record<string, string>>(() => profileValues(user.profile, user.role))
  const [saving, setSaving] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState('')
  const incompleteFields = fields[user.role].filter(({ key }) => !values[key]?.trim())
  const completion = Math.round(((fields[user.role].length - incompleteFields.length) / fields[user.role].length) * 100)
  const refreshProfile = async () => {
    try {
      const result = await request<{ user: User }>('/api/auth/profile')
      setValues(profileValues(result.user.profile, result.user.role))
      sessionStorage.setItem('skillorbit-user', JSON.stringify(result.user))
      onUserUpdate(result.user)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not refresh your profile.', 'error')
    }
  }
  usePageRefresh(refreshProfile)
  useEffect(() => {
    const token = sessionStorage.getItem('skillorbit-token')
    let objectUrl = ''
    if (token) fetch(apiUrl('/api/auth/profile/image'), { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (response.status === 404) return null
        if (!response.ok) throw new Error('Could not load your profile image.')
        return response.blob()
      })
      .then((blob) => { if (blob) { objectUrl = URL.createObjectURL(blob); setImageUrl(objectUrl) } })
      .catch((cause: unknown) => setImageError(cause instanceof Error ? cause.message : 'Could not load your profile image.'))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const result = await request<{ user: User }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(values),
      })
      setValues(profileValues(result.user.profile, result.user.role))
      sessionStorage.setItem('skillorbit-user', JSON.stringify(result.user))
      onUserUpdate(result.user)
      notify('Profile saved successfully.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save your profile.', 'error')
    } finally { setSaving(false) }
  }
  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('image', file)
    setImageBusy(true)
    try {
      await request('/api/auth/profile/image', { method: 'POST', body: form })
      const token = sessionStorage.getItem('skillorbit-token')
      const response = await fetch(apiUrl('/api/auth/profile/image'), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!response.ok) throw new Error('Image was saved but could not be loaded.')
      const blob = await response.blob()
      setImageUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(blob) })
      setImageError('')
      notify('Profile image saved.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save your image.', 'error')
    } finally { setImageBusy(false); input.value = '' }
  }
  return <Card className="form-card"><SectionHeader title="Your details" sub={`Signed in as ${user.email}`} />
    <section className="profile-completion" aria-labelledby="profile-completion-heading">
      <div className="profile-completion-heading"><div><strong id="profile-completion-heading">Profile completeness</strong><small>Complete these details to help others understand your profile.</small></div><strong>{completion}%</strong></div>
      <progress value={completion} max={100} aria-label={`Profile ${completion}% complete`} />
      <p>{incompleteFields.length ? `Still to add: ${incompleteFields.map((field) => field.label).join(', ')}.` : 'Your profile details are complete.'}</p>
    </section>
    <div className="profile-image-row"><div className="profile-image">{imageUrl ? <img src={imageUrl} alt="Your profile" /> : <span>{displayName(user).slice(0, 1).toUpperCase()}</span>}</div><div><strong>Profile image</strong><small>JPEG, PNG, or WebP · up to 3 MB</small>{imageError && <small className="image-error">{imageError}</small>}</div><label className="secondary-button image-upload">{imageBusy ? 'Uploading…' : 'Choose image'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy} onChange={(event) => void uploadImage(event)} /></label></div>
    <form className="field-grid" onSubmit={submit}>
    {fields[user.role].map((field) => <label key={field.key}>{field.label}<input value={values[field.key] || ''} maxLength={2000} placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} /></label>)}
    <div className="form-actions"><span className="muted-note">Changes are saved to your account.</span><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}<Check size={16} /></button></div>
  </form></Card>
}

function ResumePage({ user, notify }: { user: User; notify: (text: string, tone?: Notice['tone']) => void }) {
  const [resumes, setResumes] = useState<Resume[]>([])
  const [title, setTitle] = useState('')
  const [fullName, setFullName] = useState(String(user.profile.fullName || displayName(user)))
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(String(user.profile.phone || ''))
  const [summary, setSummary] = useState('')
  const [skills, setSkills] = useState('')
  const [education, setEducation] = useState('')
  const [experience, setExperience] = useState('')
  const [projects, setProjects] = useState('')
  const [certifications, setCertifications] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [previewResume, setPreviewResume] = useState<Resume | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => request<{ resumes: Resume[] }>('/api/resume').then((r) => setResumes(r.resumes)).catch((e: unknown) => notify(e instanceof Error ? e.message : 'Could not load resumes.', 'error')).finally(() => setLoading(false)), [notify])
  usePageRefresh(refresh)
  useEffect(() => { void refresh() }, [refresh])
  const clearForm = () => {
    setTitle(''); setFullName(String(user.profile.fullName || displayName(user))); setEmail(user.email); setPhone(String(user.profile.phone || ''))
    setSummary(''); setSkills(''); setEducation(''); setExperience(''); setProjects(''); setCertifications(''); setEditingId(null)
  }
  const edit = (resume: Resume) => {
    const list = (value: unknown) => resumeItems(value).join('\n')
    const contact = getResumeContact(resume, user)
    setEditingId(resume.id); setTitle(resume.title)
    setFullName(contact.fullName); setEmail(contact.email); setPhone(contact.phone)
    setSummary(String(resume.content.summary || '')); setSkills(list(resume.content.skills))
    setEducation(list(resume.content.education)); setExperience(list(resume.content.experience))
    setProjects(list(resume.content.projects)); setCertifications(list(resume.content.certifications))
  }
  const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const skillEntries = (value: string) => value.split(/\r?\n/).flatMap((line) => {
    const entry = line.trim()
    if (!entry) return []
    return /^[^:]+:\s*.+$/.test(entry) ? [entry] : entry.split(',').map((skill) => skill.trim()).filter(Boolean)
  })
  const draftResume: Resume = {
    id: editingId || 0,
    title,
    content: { fullName, email, phone, summary, skills: skillEntries(skills), education: lines(education), experience: lines(experience), projects: lines(projects), certifications: lines(certifications) },
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const body = { ...draftResume.content, title }
      if (editingId) await request(`/api/resume/${editingId}`, { method: 'PUT', body: JSON.stringify(body) })
      else await request('/api/resume', jsonBody(body))
      clearForm(); notify(editingId ? 'Resume updated.' : 'Resume saved.'); await refresh()
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save resume.', 'error') }
  }
  const remove = async (id: number) => {
    try { await request(`/api/resume/${id}`, { method: 'DELETE' }); notify('Resume deleted.'); await refresh() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not delete resume.', 'error') }
  }
  return <div className="two-col-grid resume-layout">
    <Card className="form-card"><SectionHeader title={editingId ? 'Edit resume' : 'Create a resume'} sub="Save a structured resume to your account." /><form className="stack-form" onSubmit={save}>
      <label>Resume title<input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Software engineering resume" /></label>
      <div className="resume-contact-fields"><label>Full name<input maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} /></label><label>Email<input type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Phone<input maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} /></label></div>
      <label>Professional summary<textarea maxLength={4000} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A short overview of your focus and strengths" /></label>
      <label>Technical skills <span className="optional">One category per line; otherwise comma-separated</span><textarea rows={3} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder={'Languages: Java, TypeScript\nFrameworks: React, Express'} /></label>
      <label>Education <span className="optional">One entry per line</span><textarea rows={2} value={education} onChange={(e) => setEducation(e.target.value)} placeholder="Degree, institution, year" /></label>
      <label>Experience <span className="optional">One entry per line</span><textarea rows={3} value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="Role, organization, and impact" /></label>
      <label>Projects <span className="optional">One entry per line</span><textarea rows={3} value={projects} onChange={(e) => setProjects(e.target.value)} placeholder="Project name and what you built" /></label>
      <label>Certifications <span className="optional">One entry per line</span><textarea rows={2} value={certifications} onChange={(e) => setCertifications(e.target.value)} placeholder="Certification name, issuer, year" /></label>
      <div className="resume-form-actions"><button className="primary-button" type="submit">{editingId ? 'Save changes' : 'Save resume'}{editingId ? <Check size={16} /> : <Plus size={16} />}</button><button className="secondary-button" type="button" onClick={() => setPreviewResume(draftResume)}>Preview</button>{editingId && <button className="secondary-button" type="button" onClick={clearForm}>Cancel</button>}</div>
    </form></Card>
    <Card><SectionHeader title="Your resumes" sub={`${resumes.length} saved`} />
      {loading ? <Loading /> : resumes.length ? <div className="resume-list">{resumes.map((resume) => <div className="resume-item" key={resume.id}><span className="file-icon"><FileText size={19} /></span><div><strong>{resume.title}</strong><small>{String(resume.content.summary || 'No summary added yet.')}</small></div><div className="resume-item-actions"><button className="icon-button" type="button" aria-label={`Edit ${resume.title}`} onClick={() => edit(resume)}><Settings2 size={16} /></button><button className="icon-button" type="button" aria-label={`Preview ${resume.title}`} onClick={() => setPreviewResume(resume)}><Eye size={16} /></button><button className="secondary-button compact resume-download-button" type="button" onClick={() => downloadResume(resume, user)}><ArrowDownToLine size={14} />Download LaTeX (.tex)</button><button className="icon-button danger-icon" type="button" aria-label={`Delete ${resume.title}`} onClick={() => void remove(resume.id)}><Trash2 size={16} /></button></div></div>)}</div> : <EmptyState title="No resumes yet" text="Create a resume here to get started." />}
    </Card>
    {previewResume && createPortal(<div className="resume-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewResume(null) }}>
      <section className="resume-preview-modal" role="dialog" aria-modal="true" aria-labelledby="resume-preview-title">
        <header className="resume-preview-modal-header"><div><h2 id="resume-preview-title">Resume preview</h2><p>{previewResume.title || 'Unsaved resume'}</p></div><button className="icon-button" type="button" aria-label="Close preview" onClick={() => setPreviewResume(null)}><X size={17} /></button></header>
        <div className="resume-preview-scroll"><ResumePreview resume={previewResume} user={user} /></div>
        <footer className="resume-preview-modal-footer"><button className="secondary-button" type="button" onClick={() => setPreviewResume(null)}>Close</button><button className="primary-button" type="button" onClick={() => downloadResume(previewResume, user)}><ArrowDownToLine size={15} />Download LaTeX (.tex)</button></footer>
      </section>
    </div>, document.body)}
  </div>
}

function ResumePreview({ resume, user }: { resume: Resume; user: User }) {
  const content = resume.content
  const { fullName, email, phone } = getResumeContact(resume, user)
  const summary = typeof content.summary === 'string' ? content.summary.trim() : ''
  const skills = groupResumeSkills(content.skills)
  const contacts = [email, phone].filter(Boolean)
  const sections: { title: string; values: unknown }[] = [
    { title: 'Work Experience', values: content.experience },
    { title: 'Projects', values: content.projects },
    { title: 'Education', values: content.education },
    { title: 'Certifications', values: content.certifications },
  ]
  return <article className="resume-paper">
    <header className="resume-paper-header">{fullName && <h2>{fullName}</h2>}{contacts.length > 0 && <p>{contacts.map((contact, index) => <span key={`${contact}-${index}`}>{index > 0 && <span className="resume-contact-separator"> · </span>}{contact}</span>)}</p>}</header>
    {summary && <section><h3>Professional Summary</h3><p className="resume-paper-summary">{summary}</p></section>}
    {skills.length > 0 && <section><h3>Technical Skills</h3><div className="resume-paper-skills">{skills.map((group, index) => <div key={`${group.category}-${index}`}><strong>{group.category}</strong><span>{group.skills.join(', ')}</span></div>)}</div></section>}
    {sections.map(({ title: sectionTitle, values }) => {
      const entries = resumeItems(values)
      return entries.length > 0 && <section key={sectionTitle}><h3>{sectionTitle}</h3><ul>{entries.map((entry, index) => <li key={`${sectionTitle}-${index}`}>{entry}</li>)}</ul></section>
    })}
  </article>
}

function AtsPage({ notify }: { notify: (text: string, tone?: Notice['tone']) => void }) {
  const [analyses, setAnalyses] = useState<{ id: number; fileName: string; report: { score: number; missing: string[]; matched: string[]; method: string }; createdAt: string }[]>([])
  const [result, setResult] = useState<{ id: number; score: number; matched: string[]; missing: string[]; method: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null)
  const fetchAnalyses = useCallback(async () => {
    const response = await request<{ analyses: typeof analyses }>('/api/resume/score')
    return response.analyses
  }, [])
  const refresh = useCallback(async () => {
    try {
      setAnalyses(await fetchAnalyses())
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not load history.', 'error')
    }
  }, [fetchAnalyses, notify])
  const refreshHistory = async () => {
    setHistoryLoading(true)
    try { await refresh() }
    finally { setHistoryLoading(false) }
  }
  usePageRefresh(refreshHistory)
  useEffect(() => {
    let active = true
    void fetchAnalyses()
      .then((history) => { if (active) setAnalyses(history) })
      .catch((e: unknown) => { if (active) notify(e instanceof Error ? e.message : 'Could not load history.', 'error') })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [fetchAnalyses, notify])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const body = new FormData(form)
    setLoading(true)
    try {
      const analysis = await request<typeof result>('/api/ats/upload', { method: 'POST', body })
      setResult(analysis)
      notify('Resume analyzed and saved to your history.')
      form.reset()
      await refresh()
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not analyze resume.', 'error') }
    finally { setLoading(false) }
  }
  return <div className="two-col-grid ats-layout">
    <Card className="form-card"><SectionHeader title="Analyze a resume" sub="PDF or TXT, maximum 5 MB. Analysis is stored in your history." />
      <form className="stack-form" onSubmit={submit}><label>Resume file<input type="file" name="resume" accept=".pdf,.txt,application/pdf,text/plain" required /></label><label>Job description<textarea name="jobDescription" required minLength={1} maxLength={20000} rows={8} placeholder="Paste the role description you want to compare against" /></label><button className="primary-button" disabled={loading}>{loading ? 'Analyzing…' : 'Analyze resume'}<Target size={16} /></button></form>
      <p className="method-note">Scoring uses keyword overlap (75%) and common resume sections (25%). This is a local heuristic, not a hiring prediction.</p>
    </Card>
    <div className="stack-cards">
      {result && <Card><SectionHeader title="Your result" sub="Compared with the description you provided." /><div className="score-display"><div className="score-number">{result.score}<small>/100</small></div><div><strong>Compatibility indicator</strong><small>Not a hiring prediction</small></div></div><TermList label="Matched terms" terms={result.matched} /><TermList label="Terms to consider" terms={result.missing} /></Card>}
      <Card><SectionHeader title="Analysis history" sub="Only analyses linked to your account are listed." />
        {historyLoading && !analyses.length ? <Loading /> : analyses.length ? <div className="history-list">{analyses.map((item) => <div key={item.id} className="analysis-history-entry">
          <div className="history-row"><div className="history-score">{item.report.score}</div><div><strong>{item.fileName}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div><button className="text-button" type="button" aria-expanded={expandedHistoryId === item.id} onClick={() => setExpandedHistoryId(expandedHistoryId === item.id ? null : item.id)}>{expandedHistoryId === item.id ? 'Hide details' : 'View details'}</button><button className="icon-button danger-icon" aria-label={`Delete ${item.fileName} analysis`} onClick={async () => { try { await request(`/api/resume/score/${item.id}`, { method: 'DELETE' }); await refreshHistory() } catch (e) { notify(e instanceof Error ? e.message : 'Could not delete analysis.', 'error') } }}><Trash2 size={15} /></button></div>
          {expandedHistoryId === item.id && <div className="analysis-history-details"><TermList label="Matched terms" terms={item.report.matched} /><TermList label="Terms to consider" terms={item.report.missing} /><p className="method-note">{item.report.method}</p></div>}
        </div>)}</div> : <EmptyState title="No analysis history" text="Your saved comparisons will appear here." />}
      </Card>
    </div>
  </div>
}

function TermList({ label, terms }: { label: string; terms: string[] }) {
  return <div className="term-list"><strong>{label}</strong><div>{terms.length ? terms.map((term) => <span key={term}>{term}</span>) : <small>None found.</small>}</div></div>
}

function JobsPage({ applicant, notify }: { applicant: ApplicantDetails; notify: (text: string, tone?: Notice['tone']) => void }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('')
  const [location, setLocation] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    const query = new URLSearchParams({ search, page: String(page), limit: '9' })
    if (domain) query.set('domain', domain)
    if (location) query.set('location', location)
    if (type) query.set('type', type)
    return request<{ jobs: Job[]; pages: number }>(`/api/jobs?${query}`).then((r) => { setJobs(r.jobs); setPages(r.pages); setError('') }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load opportunities.')).finally(() => setLoading(false))
  }, [search, domain, location, type, page])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  return <Card><div className="jobs-filters"><label className="search-bar"><Search size={18} /><input value={search} onChange={(e) => { setLoading(true); setSearch(e.target.value); setPage(1) }} placeholder="Search role, company, or keyword" /></label><input value={domain} onChange={(e) => { setLoading(true); setDomain(e.target.value); setPage(1) }} placeholder="Filter domain" aria-label="Filter domain" /><input value={location} onChange={(e) => { setLoading(true); setLocation(e.target.value); setPage(1) }} placeholder="Filter location" aria-label="Filter location" /><select value={type} onChange={(e) => { setLoading(true); setType(e.target.value); setPage(1) }} aria-label="Filter job type"><option value="">All types</option><option>Full-time</option><option>Internship</option><option>Contract</option><option>Part-time</option></select></div>
    {error ? <ErrorState message={error} /> : loading ? <Loading /> : jobs.length ? <><div className="job-grid">{jobs.map((job) => <JobCard key={job.id} applicant={applicant} job={job} notify={notify} />)}</div><div className="pagination"><span>Page {page} of {Math.max(1, pages)}</span><div><button className="secondary-button compact" disabled={page <= 1} onClick={() => { setLoading(true); setPage((current) => current - 1) }}>Previous</button><button className="secondary-button compact" disabled={page >= pages} onClick={() => { setLoading(true); setPage((current) => current + 1) }}>Next</button></div></div></> : <EmptyState title="No open opportunities yet" text="Try another search, or check back when employers add new roles." />}
  </Card>
}

function JobCard({ applicant, job, notify, saved = false }: { applicant: ApplicantDetails; job: Job; notify: (text: string, tone?: Notice['tone']) => void; saved?: boolean }) {
  const [working, setWorking] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [applicationOpen, setApplicationOpen] = useState(false)
  const [resumes, setResumes] = useState<Resume[]>([])
  const [resumeChoice, setResumeChoice] = useState('')
  const [resumeLoading, setResumeLoading] = useState(false)
  const [resumeError, setResumeError] = useState('')
  const openApplication = async () => {
    setApplicationOpen(true)
    setResumeLoading(true)
    setResumes([])
    setResumeChoice('')
    setResumeError('')
    try {
      const result = await request<{ resumes: Resume[] }>('/api/resume')
      setResumes(result.resumes)
      setResumeChoice(result.resumes.length ? String(result.resumes[0].id) : 'upload')
    } catch (error) {
      setResumes([])
      setResumeChoice('upload')
      setResumeError(error instanceof Error ? error.message : 'Could not load saved resumes.')
    } finally { setResumeLoading(false) }
  }
  const apply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!resumeChoice) {
      notify('Choose a saved resume or upload a PDF or TXT resume.', 'error')
      return
    }
    const formData = new FormData(event.currentTarget)
    formData.delete('resumeChoice')
    if (resumeChoice === 'upload') formData.delete('resumeId')
    else formData.set('resumeId', resumeChoice)
    setWorking(true)
    try {
      await request(`/api/jobs/${job.id}/apply`, { method: 'POST', body: formData })
      notify('Your application was submitted.')
      setApplicationOpen(false)
    }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not apply.', 'error') }
    finally { setWorking(false) }
  }
  const toggleSave = async () => {
    try {
      if (saved) await request(`/api/students/me/saved-jobs/${job.id}`, { method: 'DELETE' })
      else await request('/api/students/me/saved-jobs', jsonBody({ jobId: job.id }))
      notify(saved ? 'Removed from saved jobs.' : 'Job saved for later.')
      window.dispatchEvent(new Event('saved-jobs-changed'))
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not update saved jobs.', 'error') }
  }
  return <article className="job-card"><div className="job-card-top"><div className="company-avatar">{(job.company || 'C').slice(0, 1).toUpperCase()}</div><button className={`bookmark-button ${saved ? 'is-saved' : ''}`} type="button" aria-label={saved ? 'Remove saved job' : 'Save job'} onClick={() => void toggleSave()}>{saved ? <Check size={16} /> : <Plus size={16} />}</button></div>
    <div className="job-company">{job.company || 'Employer'}</div><h3>{job.title}</h3><div className="job-meta"><span>{job.domain || job.type || 'Opportunity'}</span><span>{job.location || 'Location flexible'}</span></div>{job.salary && <div className="job-salary">{job.salary}</div>}
    {job.description && <p className="job-description">{job.description.slice(0, 160)}{job.description.length > 160 ? '…' : ''}</p>}
    {detailsOpen && <div className="job-details" aria-label={`Details for ${job.title}`}><strong>Role description</strong><p>{job.description || 'No description provided.'}</p>{job.requirements && <><strong>Requirements</strong><p>{job.requirements}</p></>}{job.deadline && <small>Apply by {job.deadline}</small>}</div>}
    <div className="job-card-bottom"><span className="pill">{job.type || 'Full-time'}</span><div><button className="text-button" onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? 'Less' : 'Details'}</button><button className="text-button" onClick={() => void openApplication()}>Apply<ArrowRight size={15} /></button></div></div>
    {applicationOpen && createPortal(<div className="application-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setApplicationOpen(false) }}>
      <section className="application-modal" role="dialog" aria-modal="true" aria-labelledby={`application-title-${job.id}`}>
        <div className="application-modal-header"><div><h2 id={`application-title-${job.id}`}>Apply for {job.title}</h2><p>{job.company || 'Employer'} · {job.location || 'Location flexible'}</p></div><button className="icon-button" type="button" aria-label="Close application form" onClick={() => setApplicationOpen(false)}><X size={17} /></button></div>
        <form className="stack-form application-form" onSubmit={(event) => void apply(event)}>
          <label>Full name<input name="fullName" autoComplete="name" required maxLength={120} defaultValue={applicant.fullName} /></label>
          <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={applicant.email} /></label>
          <label>Phone number <span className="optional">Optional</span><input name="phone" type="tel" autoComplete="tel" maxLength={40} defaultValue={applicant.phone} /></label>
          <label>Resume<select name="resumeChoice" value={resumeChoice} disabled={resumeLoading} onChange={(event) => setResumeChoice(event.target.value)}>
            {resumeLoading && <option value="">Loading saved resumes…</option>}
            {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title} (saved resume)</option>)}
            <option value="upload">Upload a different resume for this job</option>
          </select></label>
          {resumeError && <p className="application-form-note">{resumeError} You can still upload a resume for this job.</p>}
          {resumeChoice === 'upload'
            ? <label>Job-specific resume<input type="file" name="resume" accept=".pdf,.txt,application/pdf,text/plain" required /><span className="optional">PDF or TXT · maximum 5 MB</span></label>
            : <p className="application-form-note">Your saved resume will be attached. Choose “Upload a different resume” to replace it for this application.</p>}
          <label>Short note <span className="optional">Optional</span><textarea name="coverLetter" rows={4} maxLength={2000} placeholder="Share a brief note with the employer." /></label>
          <p className="application-form-note">Your name, email, phone, note, and selected resume will be shared with this employer.</p>
          <div className="application-form-actions"><button className="secondary-button" type="button" onClick={() => setApplicationOpen(false)}>Cancel</button><button className="primary-button" disabled={working || resumeLoading}>{working ? 'Submitting…' : 'Submit application'}<ArrowRight size={15} /></button></div>
        </form>
      </section>
    </div>, document.body)}
  </article>
}

function SavedJobs({ applicant, notify }: { applicant: ApplicantDetails; notify: (text: string, tone?: Notice['tone']) => void }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState('')
  const load = useCallback(() => request<{ jobs: Job[] }>('/api/students/me/saved-jobs').then((r) => setJobs(r.jobs)).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load saved jobs.')), [])
  usePageRefresh(load)
  useEffect(() => { void load(); const listener = () => void load(); window.addEventListener('saved-jobs-changed', listener); return () => window.removeEventListener('saved-jobs-changed', listener) }, [load])
  return <Card><SectionHeader title="Bookmarked opportunities" sub="Your saved items are private to your account." />
    {error ? <ErrorState message={error} /> : jobs.length ? <div className="job-grid">{jobs.map((job) => <JobCard key={job.id} applicant={applicant} job={job} notify={notify} saved />)}</div> : <EmptyState title="Nothing saved yet" text="Save a job from Explore opportunities to find it here." />}
  </Card>
}

function JobAlertsPage({ notify }: { notify: (text: string, tone?: Notice['tone']) => void }) {
  const [alerts, setAlerts] = useState<JobAlert[]>([])
  const [filters, setFilters] = useState({ keyword: '', domain: '', location: '', type: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    return request<{ alerts: JobAlert[] }>('/api/students/me/job-alerts')
    .then((result) => { setAlerts(result.alerts); setError('') })
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load job alerts.'))
    .finally(() => setLoading(false))
  }, [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      await request('/api/students/me/job-alerts', jsonBody(filters))
      setFilters({ keyword: '', domain: '', location: '', type: '' })
      notify('Job alert saved.')
      await load()
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not save this alert.', 'error') }
    finally { setSaving(false) }
  }
  const remove = async (id: number) => {
    try { await request(`/api/students/me/job-alerts/${id}`, { method: 'DELETE' }); notify('Job alert removed.'); await load() }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not remove this alert.', 'error') }
  }
  return <div className="two-col-grid">
    <Card className="form-card"><SectionHeader title="Create a job alert" sub="Get an in-app notification when a new job matches these filters." />
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        <label>Keyword <span className="optional">Optional</span><input maxLength={120} value={filters.keyword} onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} placeholder="e.g. frontend developer" /></label>
        <label>Domain <span className="optional">Optional</span><input maxLength={120} value={filters.domain} onChange={(event) => setFilters({ ...filters, domain: event.target.value })} placeholder="e.g. Engineering" /></label>
        <label>Location <span className="optional">Optional</span><input maxLength={120} value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })} placeholder="e.g. Remote" /></label>
        <label>Job type <span className="optional">Optional</span><select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">Any type</option><option>Full-time</option><option>Internship</option><option>Contract</option><option>Part-time</option></select></label>
        <p className="method-note">Choose at least one filter. You can save up to 10 alerts.</p>
        <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save alert'}<Plus size={16} /></button>
      </form>
    </Card>
    <Card><SectionHeader title="Your job alerts" sub={`${alerts.length} of 10 saved`} />
      {error ? <ErrorState message={error} /> : loading ? <Loading /> : alerts.length ? <div className="drive-list">{alerts.map((alert) => {
        const criteria = [alert.keyword && `Keyword: ${alert.keyword}`, alert.domain && `Domain: ${alert.domain}`, alert.location && `Location: ${alert.location}`, alert.type && `Type: ${alert.type}`].filter(Boolean)
        return <div className="drive-row" key={alert.id}><span className="drive-icon"><Bell size={17} /></span><div><strong>{criteria.join(' · ')}</strong><small>Notifications appear in your existing notification center.</small></div><button className="icon-button danger-icon" type="button" aria-label={`Remove alert ${criteria.join(', ')}`} onClick={() => void remove(alert.id)}><Trash2 size={15} /></button></div>
      })}</div> : <EmptyState title="No job alerts yet" text="Save a filter to get notified when a matching job is posted." />}
    </Card>
  </div>
}

function ApplicationsPage({ notify }: { notify: (text: string, tone?: Notice['tone']) => void }) {
  const [applications, setApplications] = useState<{ id: number; status: string; appliedAt: string; title: string; company: string; location: string; fullName: string; email: string; phone: string; coverLetter: string; resumeName: string | null; canModify: boolean; history: { oldStatus: string | null; newStatus: string; createdAt: string }[] }[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => request<{ applications: typeof applications }>('/api/students/me/applications')
    .then((r) => { setApplications(r.applications); setError('') })
    .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load applications.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const save = async (event: FormEvent<HTMLFormElement>, id: number) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData()
    const formFields = new FormData(form)
    for (const key of ['fullName', 'email', 'phone', 'coverLetter']) data.set(key, String(formFields.get(key) || ''))
    const resume = (form.elements.namedItem('resume') as HTMLInputElement).files?.[0]
    if (resume) data.set('resume', resume)
    try {
      await request(`/api/students/me/applications/${id}`, { method: 'PATCH', body: data })
      setEditing(null)
      notify('Application updated.')
      await load()
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not update application.', 'error') }
  }
  const withdraw = async (application: (typeof applications)[number]) => {
    if (!window.confirm(`Withdraw your application for ${application.title}? This cannot be undone.`)) return
    try {
      await request(`/api/students/me/applications/${application.id}`, { method: 'DELETE' })
      setEditing(null)
      notify('Application withdrawn.')
      await load()
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not withdraw application.', 'error') }
  }
  const downloadResume = async (id: number, fileName: string) => {
    try {
      const token = sessionStorage.getItem('skillorbit-token')
      if (!token) throw new Error('Sign in again to download this resume.')
      const response = await fetch(apiUrl(`/api/students/me/applications/${id}/resume`), { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error('Could not download your attached resume.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not download your resume.', 'error') }
  }
  return <Card><SectionHeader title="Your application timeline" sub="Status changes are recorded as employers review applications." />
    {error ? <ErrorState message={error} /> : applications.length ? <div className="application-list">{applications.map((item) => <article className="application-card" key={item.id}>
      <div className="application-main"><div className="company-avatar">{item.company.slice(0, 1).toUpperCase()}</div><div><strong>{item.title}</strong><small>{item.company} · {item.location}</small></div><span className={`status-pill status-${item.status}`}>{item.status}</span></div>
      <div className="timeline"><span>Applied {new Date(item.appliedAt).toLocaleDateString()}</span>{item.history.map((event, index) => <span key={`${event.createdAt}-${index}`}>{event.newStatus} · {new Date(event.createdAt).toLocaleDateString()}</span>)}</div>
      <details className="application-details"><summary>View submitted details</summary><div className="application-submitted-details"><p><strong>Applicant:</strong> {item.fullName}</p><p><strong>Email:</strong> {item.email}</p><p><strong>Phone:</strong> {item.phone || 'Not provided'}</p><p><strong>Application note:</strong> {item.coverLetter || 'Not provided'}</p>{item.resumeName && <button className="secondary-button compact" type="button" onClick={() => void downloadResume(item.id, item.resumeName!)}>Download {item.resumeName}<ArrowDownToLine size={14} /></button>}</div></details>
      {item.canModify && item.status !== 'withdrawn' && <div className="application-actions"><button className="secondary-button compact" type="button" onClick={() => setEditing(editing === item.id ? null : item.id)}>{editing === item.id ? 'Cancel edit' : 'Edit application'}</button><button className="text-button withdraw-button" type="button" onClick={() => void withdraw(item)}>Withdraw</button></div>}
      {!item.canModify && item.status !== 'withdrawn' && <p className="application-locked-note">Editing and withdrawal are unavailable because this role is closed or past its deadline.</p>}
      {editing === item.id && <form className="application-edit-form" onSubmit={(event) => void save(event, item.id)}><label>Full name<input name="fullName" required maxLength={120} defaultValue={item.fullName} /></label><label>Email<input name="email" type="email" required maxLength={254} defaultValue={item.email} /></label><label>Phone<input name="phone" maxLength={40} defaultValue={item.phone} /></label><label>Application note<textarea name="coverLetter" rows={3} maxLength={2000} defaultValue={item.coverLetter} /></label><label>Replace attached resume <span className="optional">Optional · PDF or TXT, maximum 5 MB</span><input type="file" name="resume" accept=".pdf,.txt,application/pdf,text/plain" /></label><button className="primary-button">Save application changes<Check size={15} /></button></form>}
    </article>)}</div> : <EmptyState title="No applications yet" text="When you apply to an opportunity, its status and updates appear here." />}
  </Card>
}

function PracticePage({ mode, notify }: { mode: 'aptitude' | 'interview'; notify: (text: string, tone?: Notice['tone']) => void }) {
  const [topics, setTopics] = useState<string[]>([])
  const [topic, setTopic] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<{ correct: boolean | null; explanation: string } | null>(null)
  const [done, setDone] = useState<{ score: number | null; answered: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<{ id: number; mode: string; topic: string; status: string; score: number | null; createdAt: string }[]>([])
  const refreshHistory = useCallback(() => request<{ sessions: typeof history }>('/api/practice/sessions').then((r) => setHistory(r.sessions)).catch((e: unknown) => notify(e instanceof Error ? e.message : 'Could not load practice history.', 'error')), [notify])
  const refreshQuestions = useCallback(() => request<{ questions: Question[] }>(`/api/questions?mode=${mode}`).then((r) => {
      const uniqueTopics = [...new Set(r.questions.map((q) => q.topic))]
      setTopics(uniqueTopics)
      setTopic((current) => uniqueTopics.includes(current) ? current : uniqueTopics[0] || '')
    }).catch((e: unknown) => notify(e instanceof Error ? e.message : 'Could not load practice questions.', 'error')), [mode, notify])
  const refreshPage = useCallback(() => Promise.all([refreshQuestions(), refreshHistory()]), [refreshHistory, refreshQuestions])
  usePageRefresh(refreshPage)
  useEffect(() => { void refreshPage() }, [refreshPage])
  const start = async () => {
    setLoading(true)
    try {
      const result = await request<{ id: number }>(`/api/practice/sessions`, jsonBody({ mode, topic }))
      const list = await request<{ questions: Question[] }>(`/api/questions?mode=${mode}&topic=${encodeURIComponent(topic)}`)
      setSessionId(result.id); setQuestions(list.questions); setIndex(0); setFeedback(null); setDone(null); setAnswer('')
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not start practice.', 'error') }
    finally { setLoading(false) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const question = questions[index]
    if (!sessionId || !question || !answer.trim()) return
    setLoading(true)
    try {
      const result = await request<{ correct: boolean | null; explanation: string }>(`/api/practice/sessions/${sessionId}/answers`, jsonBody({ questionId: question.id, answer }))
      setFeedback(result)
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save answer.', 'error') }
    finally { setLoading(false) }
  }
  const next = async () => {
    setFeedback(null); setAnswer('')
    if (index + 1 < questions.length) setIndex(index + 1)
    else if (sessionId) {
      try {
        const result = await request<{ score: number | null; answered: number }>(`/api/practice/sessions/${sessionId}/complete`, { method: 'POST', body: '{}' })
        setDone(result); setSessionId(null)
        await refreshHistory()
      } catch (e) { notify(e instanceof Error ? e.message : 'Could not finish practice.', 'error') }
    }
  }
  const question = questions[index]
  return <div className="practice-layout">
    <Card className="practice-card">
      {!sessionId && !done && <><div className="practice-intro"><span className="practice-icon">{mode === 'aptitude' ? <Target size={22} /> : <MessageSquareText size={22} />}</span><div><h3>{mode === 'aptitude' ? 'Choose a practice topic' : 'Get ready to practice'}</h3><p>{mode === 'aptitude' ? 'Answer a short set and review explanations.' : 'Work through a question and get a simple reflection rubric.'}</p></div></div>
        <label className="select-label">Topic<select value={topic} onChange={(e) => setTopic(e.target.value)}>{topics.map((item) => <option key={item}>{item}</option>)}</select></label>
        <button className="primary-button" disabled={loading || !topic} onClick={() => void start()}>{loading ? 'Starting…' : 'Start session'}<ArrowRight size={16} /></button></>}
      {question && sessionId && !done && <><div className="practice-progress"><span>{mode === 'aptitude' ? 'QUESTION' : 'INTERVIEW PRACTICE'} {index + 1} <small>OF {questions.length}</small></span><div><i style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div></div><h3 className="question-title">{question.prompt}</h3>
        <form className="stack-form" onSubmit={submit}>{mode === 'aptitude' ? <div className="option-list">{question.options.map((option) => <label className={`answer-option ${answer === option ? 'selected' : ''}`} key={option}><input type="radio" name="answer" value={option} checked={answer === option} disabled={Boolean(feedback)} onChange={() => setAnswer(option)} /><span className="radio-dot" />{option}</label>)}</div> : <label>Your response<textarea rows={7} maxLength={4000} value={answer} disabled={Boolean(feedback)} onChange={(e) => setAnswer(e.target.value)} placeholder="Use a specific example. Explain your contribution and what you learned." /></label>}
          {feedback && <div className={`feedback-box ${feedback.correct === false ? 'feedback-review' : ''}`}><strong>{feedback.correct === null ? 'Practice reflection' : feedback.correct ? 'That’s right' : 'Not quite'}</strong><p>{feedback.explanation}</p></div>}
          <button className="primary-button" disabled={loading || (!feedback && !answer.trim())} onClick={feedback ? next : undefined} type={feedback ? 'button' : 'submit'}>{feedback ? index + 1 < questions.length ? 'Next question' : 'Finish session' : 'Submit answer'}<ArrowRight size={16} /></button>
        </form></>}
      {done && <div className="session-complete"><span className="complete-icon"><Check size={22} /></span><h3>Session complete</h3><p>{done.answered} responses saved to your practice history.</p>{done.score !== null && <div className="session-score">{done.score}%<small>correct</small></div>}<button className="secondary-button" onClick={() => setDone(null)}>Start another session<ArrowRight size={15} /></button></div>}
    </Card>
    <Card className="practice-aside"><span className="aside-icon"><Sparkles size={18} /></span><h3>Small practice, real progress.</h3><p>Your completed sessions are saved privately so you can keep building consistency.</p><div className="aside-note">Interview feedback is a simple, transparent checklist—not an AI score or a hiring assessment.</div><div className="practice-history"><strong>Recent sessions</strong>{history.slice(0, 4).map((item) => <div key={item.id}><span>{item.mode} · {item.topic}</span><small>{item.status === 'completed' ? item.score === null ? 'Completed' : `${item.score}% correct` : 'In progress'}</small></div>)}{!history.length && <small>No sessions saved yet.</small>}</div></Card>
  </div>
}

function ExperiencesPage({ notify }: { notify: (text: string, tone?: Notice['tone']) => void }) {
  const [items, setItems] = useState<{ id: number; company: string; role: string; interviewType: string; difficulty: string; rating: number; experience: string; tips: string }[]>([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => request<{ experiences: typeof items }>('/api/interview-experiences').then((r) => { setItems(r.experiences); setError('') }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load stories.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body: Record<string, unknown> = Object.fromEntries(form.entries())
    body.rating = Number(body.rating)
    try { await request('/api/interview-experiences', jsonBody(body)); notify('Thanks for sharing your experience.'); setShowForm(false); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not share experience.', 'error') }
  }
  return <>
    <div className="toolbar"><span>Community stories shared by students.</span><button className="primary-button" onClick={() => setShowForm(!showForm)}>{showForm ? <X size={16} /> : <Plus size={16} />}{showForm ? 'Close form' : 'Share your story'}</button></div>
    {showForm && <Card className="form-card story-form-card"><SectionHeader title="Share an interview story" sub="Your email and account details are not shown publicly." /><form className="field-grid" onSubmit={submit}>
      <label>Company<input required name="company" maxLength={120} /></label><label>Role<input required name="role" maxLength={120} /></label>
      <label>Interview type<select name="interviewType"><option>Technical</option><option>Behavioral</option><option>HR</option><option>Case study</option></select></label>
      <label>Difficulty<select name="difficulty"><option>Medium</option><option>Easy</option><option>Hard</option></select></label>
      <label>Rating<select name="rating">{[5, 4, 3, 2, 1].map((n) => <option value={n} key={n}>{n} / 5</option>)}</select></label>
      <label className="full-field">Your experience<textarea required rows={4} name="experience" maxLength={5000} /></label>
      <label className="full-field">Tips for other candidates<textarea rows={3} name="tips" maxLength={5000} /></label>
      <div className="form-actions full-field"><span className="muted-note">Please avoid personal or confidential information.</span><button className="primary-button">Publish story <ArrowRight size={15} /></button></div>
    </form></Card>}
    {error ? <ErrorState message={error} /> : items.length ? <div className="story-grid">{items.map((item) => <Card key={item.id} className="story-card"><div className="story-meta"><span className="pill">{item.interviewType}</span><span className="star-rating">{'★'.repeat(item.rating)}<span>{'★'.repeat(5 - item.rating)}</span></span></div><h3>{item.role} at {item.company}</h3><div className="story-sub">{item.difficulty} difficulty</div><p>{item.experience}</p>{item.tips && <div className="story-tip"><strong>Candidate tip</strong><span>{item.tips}</span></div>}</Card>)}</div> : <Card><EmptyState title="No stories yet" text="Share your experience to help another candidate prepare." /></Card>}
  </>
}

function GuidancePage() {
  const [targetRole, setTargetRole] = useState('')
  const [skills, setSkills] = useState('')
  const [result, setResult] = useState<{ summary: string; note: string; suggestions: { skill: string; reason: string }[]; sources: { title: string; url: string }[] } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const refreshGuidance = async () => {
    if (!targetRole.trim()) return
    setLoading(true)
    setError('')
    try { setResult(await request('/api/career-guidance', jsonBody({ targetRole, skills: skills.split(',').map((s) => s.trim()).filter(Boolean) }))) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load guidance.') }
    finally { setLoading(false) }
  }
  usePageRefresh(refreshGuidance)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('')
    try { setResult(await request('/api/career-guidance', jsonBody({ targetRole, skills: skills.split(',').map((s) => s.trim()).filter(Boolean) }))) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load guidance.') }
    finally { setLoading(false) }
  }
  return <div className="two-col-grid guidance-layout"><Card className="form-card"><span className="guidance-spark"><Sparkles size={21} /></span><h3>Start with a role in mind.</h3><p className="guidance-copy">Get a few practical prompts to help plan your next learning step.</p><form className="stack-form" onSubmit={submit}><label>Target role<input required maxLength={120} value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. Frontend developer" /></label><label>Current skills <span className="optional">Optional</span><textarea rows={3} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, TypeScript, accessibility…" /></label><button className="primary-button" disabled={loading}>{loading ? 'Preparing…' : 'Get practical guidance'}<ArrowRight size={16} /></button></form></Card>
    <Card><SectionHeader title="Your guidance" sub="Practical prompts with links to career resources." />
      {error ? <ErrorState message={error} /> : result ? <><div className="guidance-result"><span className="pill">FOR {targetRole.toUpperCase()}</span><p>{result.summary}</p></div>{result.suggestions.map((item) => <div className="suggestion-row" key={item.skill}><span className="suggestion-check"><Check size={14} /></span><div><strong>{item.skill}</strong><small>{item.reason}</small></div></div>)}<p className="method-note">{result.note}</p><div className="resource-links">{result.sources.map((source) => <a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowRight size={14} /></a>)}</div></> : <EmptyState title="Ready when you are" text="Enter a role to see suggested next steps and trusted career resources." />}
    </Card></div>
}

function StudentsPage() {
  const [students, setStudents] = useState<{ id: number; email: string; profile: Record<string, unknown> }[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => request<{ students: typeof students }>('/api/institution/students').then((r) => { setStudents(r.students); setError('') }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load student roster.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const filtered = students.filter((s) => `${s.profile.fullName || ''} ${s.profile.department || ''} ${s.email}`.toLowerCase().includes(search.toLowerCase()))
  return <Card><div className="table-heading"><SectionHeader title="Associated students" sub={`${filtered.length} student${filtered.length === 1 ? '' : 's'} linked to your institution`} /><label className="table-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search students" /></label></div>
    {error ? <ErrorState message={error} /> : filtered.length ? <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>EMAIL</th><th>DEPARTMENT</th><th>GRADUATION</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><span className="table-person"><span className="avatar">{String(item.profile.fullName || '?').slice(0, 1).toUpperCase()}</span><strong>{String(item.profile.fullName || 'Student')}</strong></span></td><td>{item.email}</td><td>{String(item.profile.department || '—')}</td><td>{String(item.profile.graduationYear || '—')}</td></tr>)}</tbody></table></div> : <EmptyState title="No students linked yet" text="A student can link their profile using your institution name or institution ID." />}
  </Card>
}

function DepartmentsPage({ notify }: { notify: (text: string, tone?: Notice['tone']) => void }) {
  const [departments, setDepartments] = useState<{ id: number; name: string; students: number; applications: number; selected: number }[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => request<{ departments: typeof departments }>('/api/institution/departments').then((r) => { setDepartments(r.departments); setError('') }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load departments.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const add = async (event: FormEvent) => {
    event.preventDefault()
    try { await request('/api/institution/departments', jsonBody({ name })); setName(''); notify('Department added.'); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not add department.', 'error') }
  }
  const remove = async (id: number) => {
    try { await request(`/api/institution/departments/${id}`, { method: 'DELETE' }); notify('Department removed.'); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not remove department.', 'error') }
  }
  return <div className="two-col-grid"><Card className="form-card"><SectionHeader title="Add a department" sub="Department names are private to your institution." /><form className="stack-form" onSubmit={add}><label>Department name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Computer Science" /></label><button className="primary-button">Add department <Plus size={16} /></button></form></Card><Card><SectionHeader title="Departments" sub="Outcomes are calculated from linked student and application records." />{error ? <ErrorState message={error} /> : departments.length ? <div className="department-list">{departments.map((item) => <div className="department-row" key={item.id}><span className="department-icon"><GraduationCap size={17} /></span><div className="department-copy"><strong>{item.name}</strong><small>{item.students} students · {item.applications} applications · {item.selected} selected</small></div><button className="icon-button danger-icon" aria-label={`Remove ${item.name}`} onClick={() => void remove(item.id)}><Trash2 size={15} /></button></div>)}</div> : <EmptyState title="No departments yet" text="Add a department to begin organizing your institution." />}</Card></div>
}

function DrivesPage({ notify }: { notify: (text: string, tone?: Notice['tone']) => void }) {
  const [drives, setDrives] = useState<{ id: number; title: string; companyName: string; description: string; driveDate: string | null; status: string }[]>([])
  const [error, setError] = useState('')
  const load = useCallback(() => request<{ drives: typeof drives }>('/api/institution/drives').then((r) => { setDrives(r.drives); setError('') }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load drives.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const body = Object.fromEntries(new FormData(form).entries())
    try { await request('/api/institution/drives', jsonBody(body)); form.reset(); notify('Placement drive recorded.'); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save drive.', 'error') }
  }
  const updateStatus = async (id: number, status: string) => {
    try { await request(`/api/institution/drives/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); notify('Drive status updated.'); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not update drive.', 'error') }
  }
  const remove = async (id: number) => {
    try { await request(`/api/institution/drives/${id}`, { method: 'DELETE' }); notify('Drive removed.'); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not remove drive.', 'error') }
  }
  return <div className="two-col-grid"><Card className="form-card"><SectionHeader title="Record a placement drive" sub="Track planning activity for your institution." /><form className="stack-form" onSubmit={create}><label>Drive title<input name="title" required maxLength={150} /></label><label>Company<input name="companyName" required maxLength={150} /></label><label>Date<input name="driveDate" type="date" /></label><label>Description<textarea name="description" rows={3} maxLength={4000} /></label><button className="primary-button">Save drive <Plus size={16} /></button></form><p className="method-note">Drive records are planning records; student attendance and placements are not inferred.</p></Card><Card><SectionHeader title="Recorded drives" sub={`${drives.length} drives`} />{error ? <ErrorState message={error} /> : drives.length ? <div className="drive-list">{drives.map((drive) => <div className="drive-row" key={drive.id}><span className="drive-icon"><BriefcaseBusiness size={18} /></span><div><strong>{drive.title}</strong><small>{drive.companyName} · {drive.driveDate || 'Date not set'}</small>{drive.description && <small>{drive.description}</small>}</div><select className="drive-status" aria-label={`Status for ${drive.title}`} value={drive.status} onChange={(event) => void updateStatus(drive.id, event.target.value)}><option>planned</option><option>active</option><option>completed</option></select><button className="icon-button danger-icon" aria-label={`Delete ${drive.title}`} onClick={() => void remove(drive.id)}><Trash2 size={15} /></button></div>)}</div> : <EmptyState title="No drives recorded" text="Your placement planning records will show here." />}</Card></div>
}

function InstitutionReports() {
  const [error, setError] = useState('')
  const [students, setStudents] = useState<number | null>(null)
  const load = useCallback(() => request<{ students: number }>('/api/institution/analytics').then((r) => { setStudents(r.students); setError('') }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load report summary.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  return <Card><SectionHeader title="Institution roster export" sub="Generated from students linked to this institution." />
    {error ? <ErrorState message={error} /> : <div className="report-box"><span className="report-icon"><FileText size={22} /></span><div><strong>Student roster (CSV)</strong><small>{students ?? '—'} associated student records · live export</small><p>Includes student name, email, department, university, and graduation year.</p></div><a className="secondary-button" href={apiUrl('/api/institution/reports.csv')} onClick={(event) => { const token = sessionStorage.getItem('skillorbit-token'); if (token) { event.preventDefault(); fetch(apiUrl('/api/institution/reports.csv'), { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => { if (!r.ok) throw new Error('Could not download report.'); const blob = await r.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'institution-students.csv'; link.click(); URL.revokeObjectURL(link.href) }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Download failed.')) } }}>Download CSV <ArrowDownToLine size={15} /></a></div>}
  </Card>
}

function CompanyJobs({ notify }: { notify: (text: string, tone?: Notice['tone']) => void }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => request<{ jobs: Job[] }>('/api/jobs/mine').then((r) => { setJobs(r.jobs); setError('') }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load job postings.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const body = Object.fromEntries(new FormData(form).entries())
    try {
      if (editingJob) await request(`/api/jobs/${editingJob.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      else {
        const result = await request<{ notifications: { inAppSent: number; emailsSent: number; emailsFailed: number; emailsSkipped: number; emailConfigured: boolean } }>('/api/jobs', jsonBody(body))
        const summary = result.notifications
        const failures = summary.emailsFailed
        const setup = !summary.emailConfigured ? ' Configure SendGrid to send job emails.' : ''
        const details = `In-app: ${summary.inAppSent} student(s) notified. Email: ${summary.emailsSent} sent, ${summary.emailsSkipped} skipped.`
        const followUp = failures ? ` ${failures} external delivery(ies) failed; check the server logs.` : ''
        notify(`Job posted. ${details}${followUp}${setup}`, failures ? 'error' : 'success')
      }
      form.reset(); setShowForm(false); if (editingJob) notify('Job updated.'); setEditingJob(null); await load()
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save job.', 'error') }
  }
  const changeStatus = async (job: Job) => {
    try { await request(`/api/jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: job.status === 'open' ? 'closed' : 'open' }) }); notify('Job status updated.'); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not update job.', 'error') }
  }
  const remove = async (job: Job) => {
    if (!window.confirm(`Delete “${job.title}” and its associated applications?`)) return
    try { await request(`/api/jobs/${job.id}`, { method: 'DELETE' }); notify('Job deleted.'); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not delete job.', 'error') }
  }
  return <>
    <div className="toolbar"><span>Your jobs and application counts are owner-scoped.</span><button className="primary-button" onClick={() => { setEditingJob(null); setShowForm(!showForm) }}>{showForm ? <X size={16} /> : <Plus size={16} />}{showForm ? 'Close form' : 'Post a job'}</button></div>
    {showForm && <Card className="form-card"><SectionHeader title={editingJob ? 'Edit job posting' : 'New job posting'} sub="Fields marked with * are required." /><form className="field-grid" onSubmit={create} key={editingJob?.id || 'new'}>
      <label>Job title *<input name="title" required maxLength={150} defaultValue={editingJob?.title || ''} /></label><label>Job type<select name="type" defaultValue={editingJob?.type || 'Full-time'}><option>Full-time</option><option>Internship</option><option>Contract</option><option>Part-time</option></select></label>
      <label>Domain<input name="domain" maxLength={120} placeholder="e.g. Engineering" defaultValue={editingJob?.domain || ''} /></label><label>Location<input name="location" maxLength={150} placeholder="Remote or city" defaultValue={editingJob?.location || ''} /></label>
      <label>Salary range<input name="salary" maxLength={120} defaultValue={editingJob?.salary || ''} /></label><label>Application deadline<input name="deadline" type="date" defaultValue={editingJob?.deadline || ''} /></label>
      <label className="full-field">Description *<textarea name="description" required rows={4} maxLength={10000} defaultValue={editingJob?.description || ''} /></label><label className="full-field">Requirements<textarea name="requirements" rows={3} maxLength={10000} defaultValue={editingJob?.requirements || ''} /></label>
      <div className="form-actions full-field"><span className="muted-note">You can close a posting at any time.</span><button className="primary-button">{editingJob ? 'Save changes' : 'Publish job'} <ArrowRight size={15} /></button></div>
    </form></Card>}
    <Card><SectionHeader title="Your postings" sub={`${jobs.length} total`} />    {error ? <ErrorState message={error} /> : jobs.length ? <div className="managed-job-list">{jobs.map((job) => <div className="managed-job" key={job.id}><div className="job-title-cell"><span className="company-avatar"><BriefcaseBusiness size={16} /></span><div><strong>{job.title}</strong><small>{job.domain || job.type} · {job.location}</small></div></div><span className={`status-pill ${job.status === 'open' ? 'status-open' : 'status-closed'}`}>{job.status}</span><span className="applicant-count">{job.applicants || 0} applicants</span><button className="icon-button" aria-label={`Edit ${job.title}`} onClick={() => { setEditingJob(job); setShowForm(true) }}><Settings2 size={15} /></button><button className="secondary-button compact" onClick={() => void changeStatus(job)}>{job.status === 'open' ? 'Close' : 'Reopen'}</button><button className="icon-button danger-icon" aria-label={`Delete ${job.title}`} onClick={() => void remove(job)}><Trash2 size={15} /></button></div>)}</div> : <EmptyState title="No job postings yet" text="Create your first opportunity to start building an applicant pool." />}</Card>
  </>
}

function ApplicantsPage({ notify, openApplicant }: { notify: (text: string, tone?: Notice['tone']) => void; openApplicant: (applicationId: number) => void }) {
  const [applicants, setApplicants] = useState<{ applicationId: number; status: string; appliedAt: string; email: string; jobTitle: string; coverLetter: string; resumeName: string; profile: Record<string, unknown> }[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [skills, setSkills] = useState('')
  const [experience, setExperience] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => {
    const query = new URLSearchParams({ search })
    if (status) query.set('status', status)
    if (skills) query.set('skills', skills)
    if (experience) query.set('experience', experience)
    return request<{ applicants: typeof applicants }>(`/api/company/applicants?${query}`)
      .then((r) => { setApplicants(r.applicants); setError('') })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load applicants.'))
  }, [search, status, skills, experience])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const update = async (id: number, next: string) => {
    try { await request(`/api/company/applicants/${id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); notify('Application status updated.'); await load() }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not update applicant.', 'error') }
  }
  const downloadResume = async (applicationId: number, fileName: string) => {
    try {
      const token = sessionStorage.getItem('skillorbit-token')
      if (!token) throw new Error('Sign in again to download this resume.')
      const response = await fetch(apiUrl(`/api/company/applicants/${applicationId}/resume`), { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) {
        const result = await response.json() as { message?: string }
        throw new Error(result.message || 'Could not download resume.')
      }
      const link = document.createElement('a')
      link.href = URL.createObjectURL(await response.blob())
      link.download = fileName
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not download resume.', 'error') }
  }
  const options = ['applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected']
  return <Card><div className="applicant-toolbar"><label className="table-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidate or role" /></label><input value={skills} maxLength={120} onChange={(e) => setSkills(e.target.value)} placeholder="Filter by skill" aria-label="Filter applicants by skill" /><input value={experience} maxLength={120} onChange={(e) => setExperience(e.target.value)} placeholder="Filter by experience" aria-label="Filter applicants by experience" /><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter applicants by status"><option value="">All statuses</option>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
    {error ? <ErrorState message={error} /> : applicants.length ? <div className="table-wrap"><table><thead><tr><th>CANDIDATE</th><th>ROLE</th><th>RESUME</th><th>APPLICATION NOTE</th><th>APPLIED</th><th>STATUS</th></tr></thead><tbody>{applicants.map((item) => <tr key={item.applicationId}><td><button className="applicant-profile-link" type="button" onClick={() => openApplicant(item.applicationId)} aria-label={`View ${String(item.profile.fullName || 'Student')}'s details`}><span className="table-person"><span className="avatar">{String(item.profile.fullName || '?').slice(0, 1).toUpperCase()}</span><span><strong>{String(item.profile.fullName || 'Student')}</strong><small>{item.email}{item.profile.phone ? ` · ${String(item.profile.phone)}` : ''}</small></span></span></button></td><td>{item.jobTitle}</td><td>{item.resumeName ? <button className="secondary-button compact" type="button" aria-label={`Download ${item.resumeName}`} onClick={() => void downloadResume(item.applicationId, item.resumeName)}>Download</button> : '—'}</td><td className="applicant-note">{item.coverLetter || '—'}</td><td>{new Date(item.appliedAt).toLocaleDateString()}</td><td><select className="status-select" value={item.status} onChange={(e) => void update(item.applicationId, e.target.value)}>{options.map((s) => <option key={s}>{s}</option>)}</select></td></tr>)}</tbody></table></div> : <EmptyState title="No applicants found" text="Candidates who apply to your open jobs will appear here." />}
  </Card>
}

function formatApplicantValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatApplicantValue).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${formatApplicantValue(item)}`).filter((item) => !item.endsWith(': ')).join('; ')
  return value === null || value === undefined ? '' : String(value).trim()
}

function applicantFieldLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

function applicantStatusLabel(status: string): string {
  return status === 'selected' ? 'Hired / Selected' : status.replace(/^\w/, (letter) => letter.toUpperCase())
}

function ApplicantDetailPage({ applicationId, navigate, notify }: { applicationId: number | null; navigate: (page: PageKey) => void; notify: (text: string, tone?: Notice['tone']) => void }) {
  const [applicant, setApplicant] = useState<CompanyApplicant | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resumeUrl, setResumeUrl] = useState('')
  const fetchApplicant = useCallback(() => request<{ applicant: CompanyApplicant }>(`/api/company/applicants/${applicationId}`), [applicationId])
  const load = useCallback(async () => {
    if (!applicationId) return
    setLoading(true)
    try {
      const result = await fetchApplicant()
      setApplicant(result.applicant)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load applicant details.')
    } finally { setLoading(false) }
  }, [applicationId, fetchApplicant])
  usePageRefresh(load)
  useEffect(() => {
    if (!applicationId) return
    let active = true
    fetchApplicant()
      .then((result) => { if (active) { setApplicant(result.applicant); setError('') } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load applicant details.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [applicationId, fetchApplicant])
  useEffect(() => () => { if (resumeUrl) URL.revokeObjectURL(resumeUrl) }, [resumeUrl])
  const changeStatus = async (status: string) => {
    if (!applicationId) return
    try {
      await request(`/api/company/applicants/${applicationId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      notify('Application status updated.')
      await load()
    } catch (cause) {
      setLoading(false)
      notify(cause instanceof Error ? cause.message : 'Could not update application status.', 'error')
    }
  }
  const fetchResume = async () => {
    if (!applicationId) return null
    const token = sessionStorage.getItem('skillorbit-token')
    if (!token) throw new Error('Sign in again to view this resume.')
    const response = await fetch(apiUrl(`/api/company/applicants/${applicationId}/resume`), { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) {
      const result = await response.json() as { message?: string }
      throw new Error(result.message || 'Could not load the applicant resume.')
    }
    return response.blob()
  }
  const viewResume = async () => {
    if (resumeUrl) { setResumeUrl(''); return }
    try {
      const blob = await fetchResume()
      if (blob) setResumeUrl(URL.createObjectURL(blob))
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not load the applicant resume.', 'error') }
  }
  const downloadResume = async () => {
    if (!applicant) return
    try {
      const blob = await fetchResume()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = applicant.resumeName
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not download the applicant resume.', 'error') }
  }
  if (!applicationId) return <><button className="text-button applicant-back" type="button" onClick={() => navigate('applicants')}><ArrowLeft size={15} /> Back to applicants</button><ErrorState message="Applicant not found." /></>
  if (loading) return <Card><Loading /></Card>
  if (error || !applicant) return <><button className="text-button applicant-back" type="button" onClick={() => navigate('applicants')}><ArrowLeft size={15} /> Back to applicants</button><ErrorState message={error || 'Applicant not found.'} /></>

  const profileDetails = Object.entries(applicant.profile)
    .filter(([key, value]) => !['fullName', 'phone', 'email'].includes(key) && formatApplicantValue(value))
    .map(([key, value]) => ({ label: applicantFieldLabel(key), value: formatApplicantValue(value) }))
  const statusOptions: HiringStatus[] = ['interested', 'applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected']
  const flow: HiringStatus[] = statusOptions.filter((status) => status !== 'rejected')
  const lastActiveStatus = applicant.status === 'rejected'
    ? [...applicant.history].reverse().find((event) => flow.includes(event.newStatus as HiringStatus))?.newStatus || 'applied'
    : applicant.status
  const currentStep = flow.indexOf(lastActiveStatus as HiringStatus)
  const displayName = String(applicant.profile.fullName || applicant.email)
  const phone = formatApplicantValue(applicant.profile.phone)
  return <div className="applicant-detail-page">
    <button className="text-button applicant-back" type="button" onClick={() => navigate('applicants')}><ArrowLeft size={15} /> Back to applicants</button>
    <div className="applicant-detail-grid">
      <div className="applicant-detail-main">
        <Card className="applicant-identity-card">
          <div className="applicant-identity">
            <span className="applicant-large-avatar">{displayName.slice(0, 1).toUpperCase()}</span>
            <div className="applicant-identity-copy"><span className="eyebrow">CANDIDATE PROFILE</span><h2>{displayName}</h2><p>{applicant.jobTitle}</p></div>
            <span className={`status-pill status-${applicant.status}`}>{applicantStatusLabel(applicant.status)}</span>
          </div>
          <div className="applicant-contact-grid"><div><small>Email</small><strong>{applicant.email}</strong></div><div><small>Phone</small><strong>{phone || 'Not provided'}</strong></div><div><small>Applied</small><strong>{new Date(applicant.appliedAt).toLocaleDateString()}</strong></div></div>
        </Card>
        <Card>
          <SectionHeader title="Hiring progress" sub="Current stage and every status update for this application." />
          {applicant.status === 'rejected' && <div className="applicant-rejected-note"><strong>Application rejected</strong><span>Last active stage: {applicantStatusLabel(lastActiveStatus)}.</span></div>}
          <div className="applicant-progress" aria-label={`Current hiring stage: ${applicantStatusLabel(applicant.status)}`}>
            {flow.map((status, index) => <div className={`applicant-progress-step ${index < currentStep ? 'complete' : ''} ${index === currentStep && applicant.status !== 'rejected' ? 'current' : ''}`} key={status}>
              <span className="applicant-progress-mark">{index < currentStep ? <Check size={13} /> : index + 1}</span><strong>{applicantStatusLabel(status)}</strong>
            </div>)}
          </div>
          <div className="applicant-status-control"><label htmlFor="applicant-status">Update hiring status</label><select id="applicant-status" className="status-select" value={applicant.status} onChange={(event) => void changeStatus(event.target.value)}>{statusOptions.map((status) => <option key={status} value={status}>{applicantStatusLabel(status)}</option>)}</select></div>
          <div className="applicant-history">
            {applicant.history.length ? applicant.history.map((event, index) => <div className="applicant-history-event" key={`${event.createdAt}-${index}`}><span className="applicant-history-dot" /><div><strong>{event.oldStatus ? `${applicantStatusLabel(event.oldStatus)} → ${applicantStatusLabel(event.newStatus)}` : `Application ${applicantStatusLabel(event.newStatus)}`}</strong><small>{new Date(event.createdAt).toLocaleString()}</small></div></div>) : <p className="muted-note">No status changes have been recorded yet.</p>}
          </div>
        </Card>
        <Card>
          <SectionHeader title="Applicant profile" sub="Details submitted in the candidate’s profile." />
          {profileDetails.length ? <dl className="applicant-profile-details">{profileDetails.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : <p className="muted-note">The applicant has not added additional profile details.</p>}
        </Card>
        <Card>
          <SectionHeader title="Application note" sub="Message submitted with this application." />
          <p className="applicant-cover-letter">{applicant.coverLetter || 'No application note was provided.'}</p>
        </Card>
      </div>
      <aside className="applicant-detail-side">
        <Card>
          <SectionHeader title="Attached resume" sub={applicant.resumeName || 'No resume attached'} />
          {applicant.resumeName ? <>
            <div className="applicant-resume-actions"><button className="secondary-button compact" type="button" onClick={() => void viewResume()}>{resumeUrl ? 'Hide preview' : 'View resume'}</button><button className="secondary-button compact" type="button" onClick={() => void downloadResume()}><ArrowDownToLine size={14} /> Download</button></div>
            {resumeUrl && <iframe className="applicant-resume-preview" src={resumeUrl} title={`${displayName}'s resume`} />}
          </> : <EmptyState title="Resume not attached" text="This application does not include a resume file." />}
        </Card>
        <Card>
          <SectionHeader title="Application" />
          <dl className="applicant-application-meta"><div><dt>Position</dt><dd>{applicant.jobTitle}</dd></div><div><dt>Application ID</dt><dd>#{applicant.applicationId}</dd></div><div><dt>Current status</dt><dd>{applicantStatusLabel(applicant.status)}</dd></div><div><dt>Submitted</dt><dd>{new Date(applicant.appliedAt).toLocaleString()}</dd></div></dl>
        </Card>
      </aside>
    </div>
  </div>
}

function CompanyReports() {
  const [summary, setSummary] = useState<{ jobs: { total: number; open: number }; applications: { total: number; shortlisted: number; interview: number; selected: number } } | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => request<typeof summary>('/api/company/overview').then((result) => { setSummary(result); setError('') }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load report summary.')), [])
  usePageRefresh(load)
  useEffect(() => { void load() }, [load])
  const download = async () => {
    try {
      const token = sessionStorage.getItem('skillorbit-token')
      const response = await fetch(apiUrl('/api/company/reports.csv'), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string }
        throw new Error(result.message || 'Could not download report.')
      }
      const blob = await response.blob()
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'company-hiring-report.csv'; link.click(); URL.revokeObjectURL(link.href)
    } catch (e) { window.alert(e instanceof Error ? e.message : 'Download failed.') }
  }
  return <Card><SectionHeader title="Hiring activity export" sub="Download current company-owned job and applicant records." />{error && <ErrorState message={error} />}<div className="report-box"><span className="report-icon"><FileText size={22} /></span><div><strong>Job and applicant summary (CSV)</strong><small>{summary?.jobs.total ?? '—'} jobs · {summary?.applications.total ?? '—'} applications</small><p>Includes job title, type, status, applicant name, email, status, and applied date.</p></div><button className="secondary-button" onClick={() => void download()}>Download CSV <ArrowDownToLine size={15} /></button></div></Card>
}

function Loading() {
  return <div className="loading-state"><span className="spinner" />Loading your data…</div>
}

export default App
