if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Safe storage wrapper so file:// protocol restrictions never crash the script
const memoryStorage = {};
const safeStorage = {
  getItem: function(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return memoryStorage[key] || null;
    }
  },
  setItem: function(key, val) {
    try {
      window.localStorage.setItem(key, val);
    } catch (e) {
      memoryStorage[key] = String(val);
    }
  },
  removeItem: function(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      delete memoryStorage[key];
    }
  }
};

// =========================================================================
// SECURE FIREBASE CONFIG (Read from Vercel Environment Variables)
// =========================================================================
const DEFAULT_FIREBASE_CONFIG = {
  // Uses Vite/Vercel injected environment variables instead of hardcoded strings
  "apiKey": import.meta.env ? import.meta.env.VITE_FIREBASE_API_KEY : "MISSING_KEY",
  "authDomain": import.meta.env ? import.meta.env.VITE_FIREBASE_AUTH_DOMAIN : "",
  "projectId": import.meta.env ? import.meta.env.VITE_FIREBASE_PROJECT_ID : "",
  "storageBucket": import.meta.env ? import.meta.env.VITE_FIREBASE_STORAGE_BUCKET : "",
  "messagingSenderId": import.meta.env ? import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID : "",
  "appId": import.meta.env ? import.meta.env.VITE_FIREBASE_APP_ID : ""
};

// IMPORTANT NOTE FOR VERCEL DEPLOYMENT:
// Because this uses basic HTML/JS (not a bundler like React/Vite), 
// Vercel might not inject `import.meta.env` directly into standard script tags.
// If your Vercel deployment fails to connect to Firebase, change your Firebase Config back to the 
// hardcoded strings below just before deploying. Vercel allows hardcoded Firebase Web keys 
// because Firebase uses origin restrictions (Authorized Domains) to secure the database, not hidden keys.

/* 
// Fallback Hardcoded Config (If Vercel injection fails on plain HTML):
const DEFAULT_FIREBASE_CONFIG = {
  "apiKey": "AIzaSyANIdOGd6uQc-qvls7tubsOsWTr1-7bAFk",
  "authDomain": "resumefit-cd233.firebaseapp.com",
  "projectId": "resumefit-cd233",
  "storageBucket": "resumefit-cd233.firebasestorage.app",
  "messagingSenderId": "1048653203585",
  "appId": "1:1048653203585:web:6f1e947550d2ebd84a6580"
};
*/

const KEYS = {
  USERS: 'resumefit_users_v6',
  SESSION: 'resumefit_active_session_v6',
  REMEMBERED: 'resumefit_remembered_creds_v6',
  SAVED_LOGINS: 'resumefit_saved_accounts_v6',
  THEME: 'resumefit_theme_v6',
  API_KEY: 'resumefit_gemini_key_v6'
};

let isCloudEnabled = false;
let fbAuth = null;
let fbDb = null;

let currentUser = null;
let userData = null;
let activeTrackerFilter = 'All';
let skillGapChartInstance = null;
let progressChartInstance = null;
let cloudSaveTimeout = null;

// =========================================================================
// INITIALIZE FIREBASE CLOUD (When on http/https) OR LOCAL ENGINE (file://)
// =========================================================================
function initFirebaseIfConfigured() {
  const isHttpProtocol = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  const cfg = DEFAULT_FIREBASE_CONFIG;

  if (isHttpProtocol && cfg && cfg.apiKey && cfg.projectId && typeof firebase !== 'undefined') {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(cfg);
      }
      fbAuth = firebase.auth();
      fbDb = firebase.firestore();
      isCloudEnabled = true;

      fbAuth.onAuthStateChanged(async function(fbUser) {
        if (fbUser) {
          const userObj = {
            uid: fbUser.uid,
            name: fbUser.displayName || fbUser.email.split('@')[0],
            email: fbUser.email.toLowerCase()
          };
          await loginSuccess(userObj, false);
        } else {
          // Check if a local session is active before logging out
          const activeEmail = safeStorage.getItem(KEYS.SESSION);
          const users = getUsersMap();
          if (activeEmail && users[activeEmail]) {
            await loginSuccess(users[activeEmail], false);
          } else {
            currentUser = null;
            userData = null;
            showAuthScreen();
          }
        }
      });
      return true;
    } catch (err) {
      console.warn('Firebase init fallback to Local Mode:', err);
    }
  }
  isCloudEnabled = false;
  return false;
}

// =========================================================================
// CURATED SKILL TAXONOMY & SAMPLE PRESETS
// =========================================================================
const SKILL_CATALOG = [
  { name: 'JavaScript', aliases: ['javascript', 'js', 'es6', 'ecmascript'], category: 'Frontend', project: 'Build an interactive task dashboard with modular ES6 state management and local storage persistence.', query: 'JavaScript ES6 full course freeCodeCamp MDN' },
  { name: 'TypeScript', aliases: ['typescript', 'ts'], category: 'Frontend', project: 'Refactor a REST API client using strict TypeScript interfaces, generics, and type guards.', query: 'TypeScript tutorial for beginners Total TypeScript freeCodeCamp' },
  { name: 'React', aliases: ['react', 'reactjs', 'react.js', 'react hooks'], category: 'Frontend', project: 'Build a multi-view analytics web app using React Hooks, custom context, and dynamic filtering.', query: 'React JS official documentation tutorial beta.react.dev' },
  { name: 'Next.js', aliases: ['next.js', 'nextjs'], category: 'Frontend', project: 'Create a server-rendered portfolio and blog with Next.js App Router and API routes.', query: 'Next.js App Router crash course official learn nextjs' },
  { name: 'HTML5 & CSS3', aliases: ['html', 'html5', 'css', 'css3', 'responsive design'], category: 'Frontend', project: 'Build a responsive landing page with CSS Grid, Flexbox, and WCAG accessibility compliance.', query: 'Responsive Web Design certification freeCodeCamp' },
  { name: 'Tailwind CSS', aliases: ['tailwind', 'tailwindcss', 'tailwind css'], category: 'Frontend', project: 'Design a dark-mode SaaS dashboard interface with custom Tailwind utility components.', query: 'Tailwind CSS crash course Traversy Media official docs' },
  { name: 'Node.js', aliases: ['node.js', 'nodejs', 'node'], category: 'Backend', project: 'Build a RESTful backend service with Node.js, JWT authentication, and rate-limiting middleware.', query: 'Node.js and Express.js full course freeCodeCamp' },
  { name: 'Express.js', aliases: ['express', 'expressjs', 'express.js'], category: 'Backend', project: 'Create a modular Express API with request validation, error handling, and unit tests.', query: 'Express.js REST API tutorial MDN Web Docs' },
  { name: 'Python', aliases: ['python', 'python3'], category: 'Programming', project: 'Automate data ingestion and build a CLI report generator using Python standard libraries and OOP.', query: 'CS50P Python Harvard free course YouTube' },
  { name: 'Java', aliases: ['java', 'core java', 'java 17'], category: 'Programming', project: 'Build a multithreaded inventory management service using Java Collections and Streams.', query: 'Java programming MOOC University of Helsinki' },
  { name: 'C++', aliases: ['c++', 'cpp', 'stl'], category: 'Programming', project: 'Implement a high-performance LRU Cache and graph pathfinder using C++ STL containers.', query: 'C++ STL tutorial Striver LearnCpp' },
  { name: 'Spring Boot', aliases: ['spring boot', 'springboot', 'spring mvc'], category: 'Backend', project: 'Build a CRUD microservice with Spring Boot, Spring Data JPA, and Hibernate validation.', query: 'Spring Boot tutorial Amigoscode official Spring guides' },
  { name: 'FastAPI', aliases: ['fastapi', 'fast api'], category: 'Backend', project: 'Develop an async Python inference API with FastAPI, Pydantic schemas, and OpenAPI docs.', query: 'FastAPI official tutorial documentation' },
  { name: 'Django', aliases: ['django', 'django rest framework', 'drf'], category: 'Backend', project: 'Build a role-based issue tracker backend with Django ORM and Django REST Framework.', query: 'Django for Everybody Dr. Chuck YouTube' },
  { name: 'REST APIs', aliases: ['rest api', 'rest apis', 'restful', 'api integration', 'apis'], category: 'Backend', project: 'Design and document a versioned RESTful API with pagination, status codes, and Postman tests.', query: 'REST API design best practices Postman Academy' },
  { name: 'GraphQL', aliases: ['graphql', 'apollo'], category: 'Backend', project: 'Create a GraphQL schema and resolver layer to query relational project and user data.', query: 'GraphQL full course Odyssey Apollo tutorial' },
  { name: 'SQL', aliases: ['sql', 'mysql', 'queries', 'relational database'], category: 'Data', project: 'Write complex analytical SQL queries using CTEs, window functions, and indexing on a 50k-row dataset.', query: 'SQL Bolt and Mode SQL Analytics tutorial' },
  { name: 'PostgreSQL', aliases: ['postgresql', 'postgres', 'psql'], category: 'Data', project: 'Design a normalized PostgreSQL schema with foreign keys, composite indexes, and transactions.', query: 'PostgreSQL tutorial full course freeCodeCamp' },
  { name: 'MongoDB', aliases: ['mongodb', 'mongo', 'nosql', 'mongoose'], category: 'Data', project: 'Build an aggregation pipeline in MongoDB to compute real-time user activity metrics.', query: 'MongoDB University free developer course' },
  { name: 'Redis', aliases: ['redis', 'caching'], category: 'Backend', project: 'Add a Redis caching layer to an API endpoint to reduce database latency by 80%.', query: 'Redis University crash course caching patterns' },
  { name: 'Docker', aliases: ['docker', 'containerization', 'containers', 'dockerfile'], category: 'DevOps', project: 'Containerize a full-stack web app and database using a multi-stage Dockerfile and Docker Compose.', query: 'Docker tutorial for beginners TechWorld with Nana' },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'], category: 'DevOps', project: 'Deploy a containerized web service to a local Minikube cluster with health probes and autoscaling.', query: 'Kubernetes crash course TechWorld with Nana' },
  { name: 'AWS', aliases: ['aws', 'amazon web services', 'ec2', 's3', 'lambda'], category: 'Cloud', project: 'Deploy a serverless file processing pipeline using AWS S3, Lambda, and CloudWatch logs.', query: 'AWS Cloud Practitioner essentials freeCodeCamp' },
  { name: 'CI/CD', aliases: ['ci/cd', 'github actions', 'continuous integration', 'jenkins'], category: 'DevOps', project: 'Configure a GitHub Actions workflow that automatically runs linters and unit tests on every pull request.', query: 'GitHub Actions CI/CD tutorial TechWorld with Nana' },
  { name: 'Git', aliases: ['git', 'github', 'version control'], category: 'Tools', project: 'Manage a multi-branch repository with rebasing, pull requests, and semantic commit tags.', query: 'Git and GitHub crash course freeCodeCamp' },
  { name: 'Linux', aliases: ['linux', 'bash', 'unix', 'shell scripting'], category: 'Tools', project: 'Write a Bash automation script to monitor system memory, rotate logs, and inspect network ports.', query: 'The Missing Semester of Your CS Education MIT Linux Shell' },
  { name: 'Pandas', aliases: ['pandas', 'numpy', 'data wrangling'], category: 'Data Science', project: 'Clean a raw e-commerce dataset with missing values and engineer time-series features using Pandas.', query: 'Pandas data analysis Kaggle Learn free course' },
  { name: 'Machine Learning', aliases: ['machine learning', 'ml', 'supervised learning', 'scikit-learn', 'sklearn'], category: 'AI/ML', project: 'Train, cross-validate, and evaluate a customer churn classifier using Scikit-Learn pipelines.', query: 'Machine Learning Specialization Andrew Ng Coursera' },
  { name: 'PyTorch', aliases: ['pytorch', 'deep learning', 'neural networks'], category: 'AI/ML', project: 'Build and train an image or text classification neural network in PyTorch with learning rate scheduling.', query: 'PyTorch for Deep Learning Zero to Mastery' },
  { name: 'RAG & LLMs', aliases: ['rag', 'llm', 'llms', 'large language models', 'langchain', 'prompt engineering'], category: 'AI/ML', project: 'Build a document Q&A pipeline using embeddings, chunking, and Retrieval-Augmented Generation.', query: 'DeepLearning.AI short courses RAG and LLM applications' },
  { name: 'Vector Databases', aliases: ['vector database', 'vector databases', 'pinecone', 'chromadb', 'faiss'], category: 'AI/ML', project: 'Index 500 technical articles in ChromaDB/FAISS for semantic similarity search.', query: 'Vector Databases from embeddings to applications DeepLearning.AI' },
  { name: 'Power BI', aliases: ['power bi', 'powerbi', 'dax'], category: 'Analytics', project: 'Create an interactive executive revenue and retention dashboard in Power BI using DAX measures.', query: 'Power BI full course Guy in a Cube Microsoft Learn' },
  { name: 'Tableau', aliases: ['tableau', 'data visualization'], category: 'Analytics', project: 'Build a public Tableau storyboard analyzing regional supply chain KPIs and cohort trends.', query: 'Tableau Public free training videos official' },
  { name: 'A/B Testing', aliases: ['a/b testing', 'ab testing', 'hypothesis testing', 'experimentation'], category: 'Analytics', project: 'Design a sample-size calculator and run a two-sample significance test on conversion funnel data.', query: 'A/B Testing by Google Udacity free course' },
  { name: 'Statistical Modeling', aliases: ['statistics', 'statistical modeling', 'regression', 'probability'], category: 'Analytics', project: 'Perform multiple regression and confidence interval analysis on pricing elasticity data.', query: 'StatQuest with Josh Starmer YouTube Statistics fundamentals' },
  { name: 'Excel', aliases: ['excel', 'advanced excel', 'pivot tables', 'vlookup', 'xlookup'], category: 'Analytics', project: 'Build an automated financial and cohort model using XLOOKUP, Pivot Tables, and dynamic arrays.', query: 'Excel for Business Analysts Chandoo Leila Gharani YouTube' },
  { name: 'Unit Testing', aliases: ['unit testing', 'jest', 'pytest', 'junit', 'testing', 'tdd'], category: 'Engineering', project: 'Write a test suite achieving 85%+ branch coverage using Jest or Pytest with mocked dependencies.', query: 'Unit Testing and Test Driven Development tutorial freeCodeCamp' },
  { name: 'System Design', aliases: ['system design', 'scalability', 'microservices', 'distributed systems'], category: 'Engineering', project: 'Write an architecture design document for a URL shortener with rate limiting and database sharding.', query: 'System Design Primer GitHub Gaurav Sen YouTube' },
  { name: 'Data Structures & Algorithms', aliases: ['data structures', 'algorithms', 'dsa', 'leetcode'], category: 'Engineering', project: 'Implement and benchmark graph traversal, heaps, and dynamic programming solutions in your core language.', query: 'NeetCode 150 and Abdul Bari Algorithms YouTube' },
  { name: 'Figma', aliases: ['figma', 'wireframing', 'prototyping', 'ui/ux'], category: 'Product/Design', project: 'Create a clickable mobile app prototype in Figma using auto-layout and reusable design tokens.', query: 'Figma UI UX Design Essentials official Figma YouTube' },
  { name: 'User Research', aliases: ['user research', 'usability testing', 'customer interviews'], category: 'Product/Design', project: 'Conduct 5 structured user interviews, synthesize affinity maps, and document actionable UX insights.', query: 'Nielsen Norman Group User Research fundamentals' },
  { name: 'Agile & Scrum', aliases: ['agile', 'scrum', 'jira', 'sprint planning', 'kanban'], category: 'Product', project: 'Set up a 2-week sprint backlog with user stories, acceptance criteria, and velocity tracking.', query: 'Agile with Atlassian Jira Coursera Audit' },
  { name: 'Product Strategy', aliases: ['product strategy', 'prd', 'prd writing', 'roadmap', 'product management'], category: 'Product', project: 'Write a complete Product Requirements Document (PRD) with user personas, KPIs, and rollout phases.', query: 'Product School PRD templates and case studies' }
];

const PRESET_CVS = {
  software: "ROHAN VERMA\nB.Tech in Computer Science & Engineering (2023 - Present)\nLocation: Gurugram, India\n\nSUMMARY\nMotivated Computer Science undergraduate with hands-on experience building responsive web applications and backend tools. Passionate about writing clean code and solving real-world engineering problems.\n\nTECHNICAL SKILLS\nLanguages: JavaScript, Python, SQL, HTML5, CSS3, C++\nFrameworks & Tools: React, Node.js, Express.js, Git, GitHub, Linux\n\nPROJECTS & EXPERIENCE\nFull-Stack Task & Habit Tracker | Personal Project\n- Worked on building a web application for students to track daily study tasks using React and Node.js.\n- Responsible for creating backend endpoints and storing user data in SQL tables.\n- Helped improve page loading speed and fixed UI layout bugs for mobile screens.\n\nSoftware Engineering Intern | Campus Tech Lab\n- Assisted senior developers with maintaining internal dashboard pages in HTML, CSS, and JavaScript.\n- Wrote Python scripts to parse CSV attendance logs and generate weekly summary reports.\n- Participated in team code reviews using Git and GitHub.",
  data: "PRIYA NAIR\nB.Sc. Economics & Data Science | Entry-Level Data Analyst\n\nSUMMARY\nDetail-oriented aspiring Data Analyst skilled in querying relational databases, cleaning messy datasets in Python, and building clear spreadsheet models.\n\nSKILLS\nSQL, Python, Pandas, Excel (Pivot Tables, XLOOKUP), Basic Statistics, Git\n\nEXPERIENCE & ACADEMIC PROJECTS\nRetail Sales Analysis Project\n- Worked on analyzing 25,000 retail orders using Python and Pandas to find top-selling categories.\n- Created charts and summary tables in Excel to present findings to faculty advisors.\n- Wrote SQL queries to join customer demographics with transaction history.\n\nOperations Intern | Local Logistics Startup\n- Responsible for tracking daily delivery delays in Excel spreadsheets.\n- Helped the operations manager identify bottlenecks across 12 delivery zones.",
  product: "KABIR MEHTA\nAssociate Product & UX Coordinator (Career Changer)\n\nSUMMARY\nFormer operations specialist transitioning into Product Management. Experienced in cross-functional coordination, gathering customer feedback, and documenting workflow improvements.\n\nSKILLS\nUser Research, Agile & Scrum, Figma (Wireframing), Excel, Stakeholder Communication\n\nEXPERIENCE\nOperations & Customer Success Lead | FinServe Solutions\n- Worked closely with engineering and support teams to resolve recurring customer onboarding issues.\n- Responsible for conducting user interviews with 20+ clients to understand feature requests.\n- Created wireframes in Figma for a redesigned account settings page and tracked tasks in Jira."
};

const PRESET_JOBS = {
  fullstack: {
    title: 'Full-Stack Software Engineer (SDE-1)',
    company: 'Stripe FinTech Labs',
    desc: "About the Role:\nWe are looking for a Full-Stack Software Engineer (SDE-1) to build reliable, scalable merchant dashboard features and backend payment workflows.\n\nMust-Have Qualifications (Required):\n- Strong proficiency in JavaScript and TypeScript for modern web development.\n- Hands-on experience building single-page applications with React and Tailwind CSS.\n- Backend development experience with Node.js, Express.js, and designing REST APIs.\n- Solid understanding of relational databases using SQL and PostgreSQL.\n- Experience with Git version control and writing automated Unit Testing suites (Jest).\n- Familiarity with containerization using Docker.\n\nNice-to-Have Qualifications (Preferred):\n- Experience with cloud infrastructure on AWS (S3, Lambda, EC2).\n- Exposure to CI/CD pipelines (GitHub Actions) and Redis caching.\n- Strong foundation in System Design and Data Structures & Algorithms."
  },
  data: {
    title: 'Data Analyst / Business Intelligence Associate',
    company: 'Swiggy Consumer Analytics',
    desc: "About the Role:\nJoin our central analytics team to turn high-volume order and delivery data into actionable growth decisions.\n\nRequired Skills (Must-Have):\n- Advanced proficiency in SQL for complex joins, CTEs, and window functions.\n- Strong data wrangling and exploratory analysis skills using Python and Pandas.\n- Proven ability to build interactive business dashboards in Power BI or Tableau.\n- Experience designing and evaluating A/B Testing experiments and Statistical Modeling.\n- Strong command of Advanced Excel for financial and cohort modeling.\n\nPreferred Skills (Nice-to-Have):\n- Familiarity with PostgreSQL data warehouses and Git version control.\n- Basic knowledge of Machine Learning (Scikit-Learn) for customer churn prediction."
  },
  ai: {
    title: 'AI & Machine Learning Engineer Intern',
    company: 'OpenScale AI Labs',
    desc: "About the Role:\nWe are seeking an AI/ML Engineer Intern to help build production Retrieval-Augmented Generation (RAG) assistants and model evaluation pipelines.\n\nMust-Have Requirements:\n- Strong programming skills in Python and data manipulation with Pandas.\n- Practical experience with Machine Learning (Scikit-Learn) and deep learning in PyTorch.\n- Hands-on experience building RAG & LLMs workflows and integrating Vector Databases.\n- Ability to expose ML models as production REST APIs using FastAPI.\n- Familiarity with Git and Docker for reproducible deployments.\n\nNice-to-Have Skills:\n- Experience with AWS cloud deployment, Linux shell scripting, and Unit Testing (Pytest)."
  },
  product: {
    title: 'Associate Product Manager (APM)',
    company: 'Notion Workspace',
    desc: "About the Role:\nAs an Associate Product Manager, you will partner with engineers and designers to ship intuitive collaborative workflows from conception to launch.\n\nMust-Have Requirements:\n- Demonstrated experience in Product Strategy, writing clear PRDs, and owning feature roadmaps.\n- Hands-on experience conducting User Research and translating insights into Figma wireframes.\n- Analytical mindset with working knowledge of SQL and A/B Testing to measure feature adoption.\n- Experience working in Agile & Scrum environments with engineering teams.\n\nPreferred / Nice-to-Have:\n- Familiarity with Excel cohort modeling and basic understanding of REST APIs and HTML5 & CSS3."
  }
};

// =========================================================================
// INITIALIZATION & THEME MANAGEMENT
// =========================================================================
window.addEventListener('DOMContentLoaded', function() {
  initTheme();
  setupDragAndDrop();
  renderSavedLoginsOnAuthScreen();
  prefillRememberedCredentials();

  const cloudStarted = initFirebaseIfConfigured();
  if (!cloudStarted) {
    const activeEmail = safeStorage.getItem(KEYS.SESSION);
    if (activeEmail) {
      const users = getUsersMap();
      if (users[activeEmail]) {
        loginSuccess(users[activeEmail], false);
        return;
      }
    }
    showAuthScreen();
  }
});

function initTheme() {
  const savedTheme = safeStorage.getItem(KEYS.THEME) || 'light';
  const htmlEl = document.documentElement;
  if (savedTheme === 'dark') {
    htmlEl.classList.add('dark');
    htmlEl.classList.remove('light');
  } else {
    htmlEl.classList.remove('dark');
    htmlEl.classList.add('light');
  }
  updateThemeButtonLabel();
}

function toggleTheme() {
  const htmlEl = document.documentElement;
  const isDark = htmlEl.classList.contains('dark');
  if (isDark) {
    htmlEl.classList.remove('dark');
    htmlEl.classList.add('light');
    safeStorage.setItem(KEYS.THEME, 'light');
  } else {
    htmlEl.classList.add('dark');
    htmlEl.classList.remove('light');
    safeStorage.setItem(KEYS.THEME, 'dark');
  }
  updateThemeButtonLabel();
  if (userData) {
    const activeScan = getActiveScan();
    if (activeScan) renderSkillGapChart(activeScan);
    renderProgressHistoryChart();
  }
}

function updateThemeButtonLabel() {
  const isDark = document.documentElement.classList.contains('dark');
  const label = document.getElementById('themeBtnLabel');
  if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

// =========================================================================
// PASSWORD HASHING, STRENGTH METER & HYBRID AUTHENTICATION
// =========================================================================
function hashPassword(plain) {
  const salted = 'rf_salt_2026::' + plain + '::resumefit';
  let h1 = 0xdeadbeef ^ salted.length;
  let h2 = 0x41c6ce57 ^ salted.length;
  for (let i = 0, ch; i < salted.length; i++) {
    ch = salted.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'pwh_' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function verifyUserPassword(userRecord, inputPassword) {
  if (!userRecord || !inputPassword) return false;
  if (userRecord.passwordHash) {
    return userRecord.passwordHash === hashPassword(inputPassword);
  }
  return userRecord.password === inputPassword;
}

function evaluatePasswordStrength(pw) {
  const label = document.getElementById('pwStrengthLabel');
  const bars = [
    document.getElementById('pwBar1'),
    document.getElementById('pwBar2'),
    document.getElementById('pwBar3'),
    document.getElementById('pwBar4')
  ];
  const baseClass = 'h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 transition-colors';
  bars.forEach(function(b) { if (b) b.className = baseClass; });

  if (!pw) {
    label.textContent = 'Min 6 characters';
    label.className = 'text-[11px] font-bold text-slate-400';
    return;
  }

  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;

  if (pw.length < 6) {
    bars[0].className = 'h-1.5 rounded-full bg-rose-500 transition-colors';
    label.textContent = 'Too short (min 6 chars)';
    label.className = 'text-[11px] font-bold text-rose-500';
  } else if (score <= 1) {
    bars[0].className = 'h-1.5 rounded-full bg-rose-500 transition-colors';
    label.textContent = 'Weak password';
    label.className = 'text-[11px] font-bold text-rose-500';
  } else if (score === 2) {
    bars[0].className = 'h-1.5 rounded-full bg-amber-500 transition-colors';
    bars[1].className = 'h-1.5 rounded-full bg-amber-500 transition-colors';
    label.textContent = 'Fair password';
    label.className = 'text-[11px] font-bold text-amber-500';
  } else if (score === 3) {
    bars[0].className = 'h-1.5 rounded-full bg-brand-500 transition-colors';
    bars[1].className = 'h-1.5 rounded-full bg-brand-500 transition-colors';
    bars[2].className = 'h-1.5 rounded-full bg-brand-500 transition-colors';
    label.textContent = 'Good password';
    label.className = 'text-[11px] font-bold text-brand-500';
  } else {
    bars.forEach(function(b) { if (b) b.className = 'h-1.5 rounded-full bg-emerald-500 transition-colors'; });
    label.textContent = 'Strong password';
    label.className = 'text-[11px] font-bold text-emerald-500';
  }
}

function showAuthAlert(message, type) {
  type = type || 'error';
  const banner = document.getElementById('authAlertBanner');
  if (!banner) return;
  if (!message) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  if (type === 'error') {
    banner.className = 'mb-4 p-3 rounded-xl text-xs font-semibold flex items-center gap-2 bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800';
    banner.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i><span>' + escapeHtml(message) + '</span>';
  } else {
    banner.className = 'mb-4 p-3 rounded-xl text-xs font-semibold flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
    banner.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>' + escapeHtml(message) + '</span>';
  }
}

function getUsersMap() {
  try {
    return JSON.parse(safeStorage.getItem(KEYS.USERS)) || {};
  } catch (e) {
    return {};
  }
}

function saveUsersMap(map) {
  safeStorage.setItem(KEYS.USERS, JSON.stringify(map));
}

function switchAuthTab(mode, focusInput) {
  showAuthAlert(null);
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabSignupBtn = document.getElementById('tabSignupBtn');
  const authCardBox = document.getElementById('authCardBox');

  if (mode === 'login') {
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    tabLoginBtn.className = 'py-2.5 text-sm font-semibold rounded-lg transition bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm';
    tabSignupBtn.className = 'py-2.5 text-sm font-semibold rounded-lg transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
    if (focusInput) {
      authCardBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function() { document.getElementById('loginEmail').focus(); }, 150);
    }
  } else {
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    tabSignupBtn.className = 'py-2.5 text-sm font-semibold rounded-lg transition bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm';
    tabLoginBtn.className = 'py-2.5 text-sm font-semibold rounded-lg transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
    if (focusInput) {
      authCardBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function() { document.getElementById('signupName').focus(); }, 150);
    }
  }
}

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.className = 'fa-regular fa-eye-slash text-sm text-brand-600';
  } else {
    input.type = 'password';
    if (icon) icon.className = 'fa-regular fa-eye text-sm';
  }
}

function prefillRememberedCredentials() {
  try {
    const rem = JSON.parse(safeStorage.getItem(KEYS.REMEMBERED));
    if (rem && rem.email) {
      document.getElementById('loginEmail').value = rem.email || '';
      document.getElementById('loginPassword').value = rem.password || '';
      document.getElementById('loginRemember').checked = true;
    }
  } catch (e) {}
}

function saveAccountToQuickList(user, rememberedPasswordPlain) {
  try {
    let list = JSON.parse(safeStorage.getItem(KEYS.SAVED_LOGINS)) || [];
    list = list.filter(function(item) { return item.email.toLowerCase() !== user.email.toLowerCase(); });
    list.unshift({
      name: user.name,
      email: user.email,
      rememberedPassword: rememberedPasswordPlain || ''
    });
    safeStorage.setItem(KEYS.SAVED_LOGINS, JSON.stringify(list.slice(0, 5)));
  } catch (e) {}
}

function renderSavedLoginsOnAuthScreen() {
  const box = document.getElementById('savedAccountsBox');
  const listEl = document.getElementById('savedAccountsList');
  if (!box || !listEl) return;

  let list = [];
  try {
    list = JSON.parse(safeStorage.getItem(KEYS.SAVED_LOGINS)) || [];
  } catch (e) {}

  if (list.length === 0) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  listEl.innerHTML = list.map(function(acc, idx) {
    const initial = escapeHtml((acc.name || acc.email)[0].toUpperCase());
    const iconCls = acc.rememberedPassword ? 'fa-key' : 'fa-lock';
    const actionTxt = acc.rememberedPassword ? 'Autofill & Sign In' : 'Enter Password';
    return '<div onclick="selectSavedAccount(' + idx + ')" class="cursor-pointer p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-brand-500 dark:hover:border-brand-400 bg-slate-50/70 dark:bg-slate-800/50 flex items-center justify-between transition">' +
      '<div class="flex items-center gap-2.5 min-w-0">' +
        '<div class="w-7 h-7 rounded-lg bg-brand-600 text-white font-bold text-xs flex items-center justify-center shrink-0">' + initial + '</div>' +
        '<div class="truncate">' +
          '<p class="text-xs font-bold text-slate-900 dark:text-white truncate">' + escapeHtml(acc.name) + '</p>' +
          '<p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">' + escapeHtml(acc.email) + '</p>' +
        '</div>' +
      '</div>' +
      '<span class="text-[11px] font-semibold text-brand-600 dark:text-brand-400 shrink-0 ml-2 flex items-center gap-1">' +
        '<i class="fa-solid ' + iconCls + ' text-[10px]"></i>' + actionTxt +
      '</span>' +
    '</div>';
  }).join('');
}

function selectSavedAccount(index) {
  try {
    const list = JSON.parse(safeStorage.getItem(KEYS.SAVED_LOGINS)) || [];
    const acc = list[index];
    if (!acc) return;

    switchAuthTab('login');
    document.getElementById('loginEmail').value = acc.email;

    if (acc.rememberedPassword) {
      document.getElementById('loginPassword').value = acc.rememberedPassword;
      document.getElementById('loginRemember').checked = true;
      showAuthAlert('Credentials autofilled for ' + acc.email + '. Click "Sign In with Password" to continue.', 'success');
    } else {
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginPassword').focus();
      showAuthAlert('Please enter the password for ' + acc.email + '.', 'error');
    }
  } catch (e) {}
}

function clearSavedLogins() {
  safeStorage.removeItem(KEYS.SAVED_LOGINS);
  safeStorage.removeItem(KEYS.REMEMBERED);
  renderSavedLoginsOnAuthScreen();
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  showToast('Cleared saved login credentials on this device.', 'info');
}

// SIGN UP (Firebase Cloud with Seamless Local Fallback)
async function handleSignup(e) {
  e.preventDefault();
  showAuthAlert(null);

  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim().toLowerCase();
  const password = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupConfirmPassword').value;
  const remember = document.getElementById('signupRemember').checked;

  if (!name || !email || !password) {
    showAuthAlert('Please complete all required fields.', 'error');
    return;
  }
  if (password.length < 6) {
    showAuthAlert('Password must be at least 6 characters long.', 'error');
    return;
  }
  if (password !== confirmPassword) {
    showAuthAlert('Passwords do not match. Please re-check your password confirmation.', 'error');
    return;
  }

  if (isCloudEnabled && fbAuth) {
    try {
      const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      const userObj = { uid: cred.user.uid, name: name, email: email };
      if (remember) {
        safeStorage.setItem(KEYS.REMEMBERED, JSON.stringify({ email: email, password: password }));
        saveAccountToQuickList(userObj, password);
      } else {
        safeStorage.removeItem(KEYS.REMEMBERED);
        saveAccountToQuickList(userObj, '');
      }
      await loginSuccess(userObj, true);
      return;
    } catch (err) {
      if (err && err.code === 'auth/email-already-in-use') {
        switchAuthTab('login');
        document.getElementById('loginEmail').value = email;
        showAuthAlert('An account with this email already exists. Please sign in with your password.', 'error');
        return;
      }
      console.warn('Cloud signup unavailable, falling back to Local Account Engine:', err);
    }
  }

  // Local Account Engine (Also saves locally so it never fails)
  const users = getUsersMap();
  if (users[email]) {
    switchAuthTab('login');
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginPassword').focus();
    showAuthAlert('An account with this email already exists. Please enter your password to sign in.', 'error');
    return;
  }

  const newUser = {
    uid: 'local_' + simpleHash(email),
    name: name,
    email: email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  users[email] = newUser;
  saveUsersMap(users);

  if (remember) {
    safeStorage.setItem(KEYS.REMEMBERED, JSON.stringify({ email: email, password: password }));
    saveAccountToQuickList(newUser, password);
  } else {
    safeStorage.removeItem(KEYS.REMEMBERED);
    saveAccountToQuickList(newUser, '');
  }

  await loginSuccess(newUser, true);
}

// SIGN IN (Firebase Cloud with Seamless Local Fallback)
async function handleLogin(e) {
  e.preventDefault();
  showAuthAlert(null);

  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const remember = document.getElementById('loginRemember').checked;

  if (isCloudEnabled && fbAuth) {
    try {
      const cred = await fbAuth.signInWithEmailAndPassword(email, password);
      const userObj = {
        uid: cred.user.uid,
        name: cred.user.displayName || email.split('@')[0],
        email: email
      };
      if (remember) {
        safeStorage.setItem(KEYS.REMEMBERED, JSON.stringify({ email: email, password: password }));
        saveAccountToQuickList(userObj, password);
      } else {
        safeStorage.removeItem(KEYS.REMEMBERED);
        saveAccountToQuickList(userObj, '');
      }
      await loginSuccess(userObj, true);
      return;
    } catch (err) {
      if (err && (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found')) {
        const localUsers = getUsersMap();
        if (!localUsers[email]) {
          showAuthAlert('Invalid email or password. Please check your credentials or click "Create Account".', 'error');
          return;
        }
      }
      console.warn('Cloud login fallback to Local Account Engine:', err);
    }
  }

  const users = getUsersMap();
  const existing = users[email];

  if (!existing) {
    showAuthAlert('No account found with this email. Click "Create Account" above to register.', 'error');
    return;
  }

  if (!verifyUserPassword(existing, password)) {
    showAuthAlert('Incorrect password. Please try again or click "Forgot password?".', 'error');
    return;
  }

  if (remember) {
    safeStorage.setItem(KEYS.REMEMBERED, JSON.stringify({ email: email, password: password }));
    saveAccountToQuickList(existing, password);
  } else {
    safeStorage.removeItem(KEYS.REMEMBERED);
    saveAccountToQuickList(existing, '');
  }

  await loginSuccess(existing, true);
}

// GOOGLE SIGN IN
async function handleGoogleAuthClick() {
  if (isCloudEnabled && fbAuth) {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await fbAuth.signInWithPopup(provider);
      const userObj = {
        uid: result.user.uid,
        name: result.user.displayName || result.user.email.split('@')[0],
        email: result.user.email.toLowerCase()
      };
      saveAccountToQuickList(userObj, '');
      await loginSuccess(userObj, true);
      return;
    } catch (err) {
      console.warn('Google popup fallback to modal:', err);
    }
  }
  document.getElementById('googleModal').classList.remove('hidden');
}

function closeGoogleModal() {
  document.getElementById('googleModal').classList.add('hidden');
}

async function handleGoogleSignInLocal(e) {
  e.preventDefault();
  const name = document.getElementById('googleNameInput').value.trim();
  const email = document.getElementById('googleEmailInput').value.trim().toLowerCase();
  const password = document.getElementById('googlePasswordInput').value;
  if (!name || !email || !password) return;

  const users = getUsersMap();
  const existing = users[email];

  if (existing) {
    if (!verifyUserPassword(existing, password)) {
      showToast('Incorrect password for this existing account.', 'error');
      return;
    }
    saveAccountToQuickList(existing, password);
    closeGoogleModal();
    await loginSuccess(existing, true);
    return;
  }

  const userObj = {
    uid: 'local_' + simpleHash(email),
    name: name,
    email: email,
    passwordHash: hashPassword(password),
    provider: 'google',
    createdAt: new Date().toISOString()
  };
  users[email] = userObj;
  saveUsersMap(users);
  safeStorage.setItem(KEYS.REMEMBERED, JSON.stringify({ email: email, password: password }));
  saveAccountToQuickList(userObj, password);
  closeGoogleModal();
  await loginSuccess(userObj, true);
}

// FORGOT / RESET PASSWORD
function openForgotPasswordModal() {
  const currentEmail = document.getElementById('loginEmail').value.trim();
  const resetEmailEl = document.getElementById('resetEmailInput');
  const resetNewPwEl = document.getElementById('resetNewPasswordInput');
  if (resetEmailEl) resetEmailEl.value = currentEmail;
  if (resetNewPwEl) resetNewPwEl.value = '';
  document.getElementById('forgotPasswordModal').classList.remove('hidden');
}

function closeForgotPasswordModal() {
  document.getElementById('forgotPasswordModal').classList.add('hidden');
}

async function handleResetPassword(e) {
  e.preventDefault();
  const email = document.getElementById('resetEmailInput').value.trim().toLowerCase();
  const newPassword = document.getElementById('resetNewPasswordInput').value;

  const users = getUsersMap();
  if (users[email] && newPassword && newPassword.length >= 6) {
    users[email].passwordHash = hashPassword(newPassword);
    delete users[email].password;
    saveUsersMap(users);
    safeStorage.setItem(KEYS.REMEMBERED, JSON.stringify({ email: email, password: newPassword }));
    saveAccountToQuickList(users[email], newPassword);
    renderSavedLoginsOnAuthScreen();
    closeForgotPasswordModal();
    switchAuthTab('login');
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = newPassword;
    showAuthAlert('Password updated! Click "Sign In with Password" below.', 'success');
    return;
  }

  if (isCloudEnabled && fbAuth) {
    try {
      await fbAuth.sendPasswordResetEmail(email);
      closeForgotPasswordModal();
      showAuthAlert('Password reset email sent to ' + email + '! Check your inbox.', 'success');
      showToast('Password reset link sent!', 'success');
      return;
    } catch (err) {
      showToast(err.message || 'Could not send reset email.', 'error');
      return;
    }
  }

  showToast('Enter a new password (min 6 chars) for your registered email.', 'error');
}

// CHANGE PASSWORD IN-APP
function openChangePasswordModal() {
  document.getElementById('currentPasswordInput').value = '';
  document.getElementById('newPasswordInput').value = '';
  document.getElementById('confirmNewPasswordInput').value = '';
  document.getElementById('changePasswordModal').classList.remove('hidden');
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal').classList.add('hidden');
}

async function handleChangePassword(e) {
  e.preventDefault();
  if (!currentUser) return;

  const curPw = document.getElementById('currentPasswordInput').value;
  const newPw = document.getElementById('newPasswordInput').value;
  const confirmPw = document.getElementById('confirmNewPasswordInput').value;

  if (newPw.length < 6) {
    showToast('New password must be at least 6 characters.', 'error');
    return;
  }
  if (newPw !== confirmPw) {
    showToast('New passwords do not match.', 'error');
    return;
  }

  if (isCloudEnabled && fbAuth && fbAuth.currentUser) {
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, curPw);
      await fbAuth.currentUser.reauthenticateWithCredential(cred);
      await fbAuth.currentUser.updatePassword(newPw);
      safeStorage.setItem(KEYS.REMEMBERED, JSON.stringify({ email: currentUser.email, password: newPw }));
      saveAccountToQuickList(currentUser, newPw);
      closeChangePasswordModal();
      showToast('Password updated across all devices!', 'success');
      return;
    } catch (err) {
      console.warn('Cloud password change fallback:', err);
    }
  }

  const users = getUsersMap();
  const userRecord = users[currentUser.email.toLowerCase()];

  if (userRecord && !verifyUserPassword(userRecord, curPw)) {
    showToast('Current password is incorrect.', 'error');
    return;
  }

  if (userRecord) {
    userRecord.passwordHash = hashPassword(newPw);
    delete userRecord.password;
    users[currentUser.email.toLowerCase()] = userRecord;
    currentUser = userRecord;
    saveUsersMap(users);
  }

  safeStorage.setItem(KEYS.REMEMBERED, JSON.stringify({ email: currentUser.email, password: newPw }));
  saveAccountToQuickList(currentUser, newPw);

  closeChangePasswordModal();
  showToast('Your account password has been changed!', 'success');
}

// LOGIN SUCCESS & LOGOUT
async function loginSuccess(userObj, showWelcomeToast) {
  currentUser = userObj;
  safeStorage.setItem(KEYS.SESSION, userObj.email.toLowerCase());
  await loadUserWorkspace(userObj);

  document.getElementById('userNameDisplay').textContent = userObj.name;
  document.getElementById('userEmailDisplay').textContent = userObj.email;
  document.getElementById('userAvatar').textContent = (userObj.name || userObj.email)[0].toUpperCase();
  document.getElementById('dashWelcomeName').textContent = userObj.name.split(' ')[0];

  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');

  refreshAllUI();
  navigate('dashboard');

  if (showWelcomeToast) {
    showToast('Signed in as ' + userObj.name, 'success');
  }
}

async function handleLogout() {
  safeStorage.removeItem(KEYS.SESSION);
  if (isCloudEnabled && fbAuth) {
    try {
      await fbAuth.signOut();
    } catch (e) {
      console.warn(e);
    }
  }
  currentUser = null;
  userData = null;
  renderSavedLoginsOnAuthScreen();
  prefillRememberedCredentials();
  showAuthAlert(null);
  showAuthScreen();
  showToast('Signed out of your account.', 'info');
}

function showAuthScreen() {
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
}

// =========================================================================
// CLOUD FIRESTORE + LOCAL STORAGE WORKSPACE SYNC
// =========================================================================
function getUserDataKey(email) {
  return 'resumefit_workspace_' + email.toLowerCase();
}

function createDefaultWorkspace(today) {
  return {
    cvText: '',
    cvFileName: '',
    cvUpdatedAt: null,
    scans: [],
    activeScanId: null,
    applications: [],
    quota: { date: today, used: 0, limit: 15 },
    cache: {}
  };
}

async function loadUserWorkspace(userObj) {
  const today = new Date().toISOString().slice(0, 10);
  const emailKey = getUserDataKey(userObj.email);
  userData = null;

  if (isCloudEnabled && fbDb && userObj.uid && !String(userObj.uid).startsWith('local_')) {
    try {
      const docRef = fbDb.collection('workspaces').doc(userObj.uid);
      const snap = await docRef.get();
      if (snap.exists) {
        userData = snap.data();
      } else {
        const localRaw = safeStorage.getItem(emailKey);
        userData = localRaw ? JSON.parse(localRaw) : createDefaultWorkspace(today);
        await docRef.set(userData);
      }
    } catch (err) {
      console.warn('Firestore read fallback to localStorage:', err);
    }
  }

  if (!userData) {
    try {
      const raw = safeStorage.getItem(emailKey);
      if (raw) userData = JSON.parse(raw);
    } catch (e) {}
  }

  if (!userData) {
    userData = createDefaultWorkspace(today);
  }

  if (!userData.quota || userData.quota.date !== today) {
    userData.quota = { date: today, used: 0, limit: 15 };
  }
  if (!Array.isArray(userData.scans)) userData.scans = [];
  if (!Array.isArray(userData.applications)) userData.applications = [];
  if (!userData.cache) userData.cache = {};

  saveUserWorkspace();
}

function saveUserWorkspace() {
  if (!currentUser || !userData) return;
  safeStorage.setItem(getUserDataKey(currentUser.email), JSON.stringify(userData));

  if (isCloudEnabled && fbDb && currentUser.uid && !String(currentUser.uid).startsWith('local_')) {
    clearTimeout(cloudSaveTimeout);
    cloudSaveTimeout = setTimeout(async function() {
      try {
        await fbDb.collection('workspaces').doc(currentUser.uid).set(userData);
      } catch (err) {
        console.warn('Firestore write warning:', err);
      }
    }, 350);
  }
}

function getActiveScan() {
  if (!userData || !userData.scans.length) return null;
  return userData.scans.find(function(s) { return s.id === userData.activeScanId; }) || userData.scans[0];
}

// =========================================================================
// NAVIGATION & GLOBAL UI REFRESH
// =========================================================================
function navigate(viewName) {
  document.querySelectorAll('.app-view').forEach(function(sec) { sec.classList.add('hidden'); });
  const target = document.getElementById('view-' + viewName);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(function(btn) {
    const isCurrent = btn.getAttribute('data-nav') === viewName;
    if (isCurrent) {
      btn.className = 'nav-btn w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition bg-brand-50 dark:bg-brand-950/80 text-brand-700 dark:text-brand-300';
    } else {
      btn.className = 'nav-btn w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60';
    }
  });

  const sidebar = document.getElementById('sidebar');
  if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
    sidebar.classList.add('-translate-x-full');
  }

  refreshAllUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('-translate-x-full');
}

function refreshAllUI() {
  if (!userData) return;

  const left = Math.max(0, userData.quota.limit - userData.quota.used);
  const pct = Math.round((left / userData.quota.limit) * 100);
  document.getElementById('quotaText').textContent = left + ' / ' + userData.quota.limit + ' left';
  document.getElementById('quotaBar').style.width = pct + '%';
  document.getElementById('dashQuotaLeft').textContent = left;

  const cvEditor = document.getElementById('cvTextEditor');
  if (cvEditor && document.activeElement !== cvEditor) {
    cvEditor.value = userData.cvText || '';
  }
  updateCvWordCount();

  const hasCv = userData.cvText && userData.cvText.trim().length > 20;
  const cvBadge = document.getElementById('sidebarCvBadge');
  if (hasCv) {
    cvBadge.textContent = 'Ready';
    cvBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    document.getElementById('dashCvSummary').textContent = userData.cvFileName
      ? 'Source: ' + userData.cvFileName + ' (' + countWords(userData.cvText) + ' words)'
      : 'Custom CV saved (' + countWords(userData.cvText) + ' words)';
    document.getElementById('dashCvPreviewBox').textContent = userData.cvText.slice(0, 500) + (userData.cvText.length > 500 ? '...' : '');
    document.getElementById('matchCvStatusText').innerHTML = '<span class="text-emerald-600 dark:text-emerald-400 font-semibold"><i class="fa-solid fa-check-circle mr-1"></i>CV Ready (' + countWords(userData.cvText) + ' words)</span> &mdash; Ready for matching.';
  } else {
    cvBadge.textContent = 'Empty';
    cvBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500';
    document.getElementById('dashCvSummary').textContent = 'No resume uploaded yet.';
    document.getElementById('dashCvPreviewBox').textContent = 'Upload a PDF, PNG/JPG, or paste your CV text in Resume Studio to begin.';
    document.getElementById('matchCvStatusText').innerHTML = '<span class="text-amber-600 dark:text-amber-400 font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>No CV uploaded yet.</span> Click "Edit CV" to add your resume first.';
  }

  const activeScan = getActiveScan();
  const scoreBadge = document.getElementById('sidebarScoreBadge');
  const roadmapBadge = document.getElementById('sidebarRoadmapBadge');

  if (activeScan) {
    scoreBadge.classList.remove('hidden');
    scoreBadge.textContent = activeScan.score + '%';
    document.getElementById('dashLatestScore').textContent = activeScan.score + '%';
    document.getElementById('dashLatestJob').textContent = activeScan.jobTitle + ' @ ' + activeScan.company;

    const prog = calculateRoadmapProgress(activeScan);
    roadmapBadge.classList.remove('hidden');
    roadmapBadge.textContent = prog.pct + '%';
    document.getElementById('dashRoadmapPct').textContent = prog.pct + '%';
    document.getElementById('dashRoadmapSteps').textContent = prog.done + ' of ' + prog.total + ' steps completed';
  } else {
    scoreBadge.classList.add('hidden');
    roadmapBadge.classList.add('hidden');
    document.getElementById('dashLatestScore').textContent = '--';
    document.getElementById('dashLatestJob').textContent = 'No scans yet';
    document.getElementById('dashRoadmapPct').textContent = '0%';
    document.getElementById('dashRoadmapSteps').textContent = '0 of 0 steps completed';
  }

  document.getElementById('dashJobsCount').textContent = userData.applications.length;
  document.getElementById('sidebarTrackerBadge').textContent = userData.applications.length;

  renderDashboardRecentScans();
  populateRescanDropdown();
  renderMatchResultsView();
  renderRoadmapView();
  renderProgressView();
  renderTrackerView();
}

// =========================================================================
// RESUME STUDIO: FILE UPLOAD (PDF.js / Canvas Image Compression / Text)
// =========================================================================
function setupDragAndDrop() {
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;
  ['dragenter', 'dragover'].forEach(function(evt) {
    dropZone.addEventListener(evt, function(e) {
      e.preventDefault();
      dropZone.classList.add('border-brand-500', 'bg-brand-50/30');
    });
  });
  ['dragleave', 'drop'].forEach(function(evt) {
    dropZone.addEventListener(evt, function(e) {
      e.preventDefault();
      dropZone.classList.remove('border-brand-500', 'bg-brand-50/30');
    });
  });
  dropZone.addEventListener('drop', function(e) {
    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length > 0) {
      processUploadedFile(files[0]);
    }
  });
}

function handleFileUpload(e) {
  const file = e.target.files ? e.target.files[0] : null;
  if (file) processUploadedFile(file);
  e.target.value = '';
}

async function processUploadedFile(file) {
  const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!validTypes.includes(file.type) && !['pdf', 'png', 'jpg', 'jpeg', 'txt'].includes(ext)) {
    showToast('Unsupported file format. Please upload a PDF, PNG, JPEG, or TXT file.', 'error');
    return;
  }

  if (file.size > 4.2 * 1024 * 1024) {
    showToast('File exceeds the 4 MB maximum limit. Please upload a smaller file.', 'error');
    return;
  }

  const statusBox = document.getElementById('fileProcessingStatus');
  const statusText = document.getElementById('fileProcessingText');
  statusBox.classList.remove('hidden');

  try {
    if (ext === 'txt' || file.type === 'text/plain') {
      statusText.textContent = 'Reading text file...';
      const text = await file.text();
      applyExtractedCvText(text, file.name, 'Extracted from TXT (0 AI quota used)');
    } else if (ext === 'pdf' || file.type === 'application/pdf') {
      statusText.textContent = 'Extracting PDF text in browser (first 3 pages)...';
      const text = await extractTextFromPDF(file);
      if (text && text.trim().length > 30) {
        applyExtractedCvText(text, file.name, 'Parsed in browser via PDF.js (0 AI quota used)');
      } else {
        applyExtractedCvText(
          '[Scanned PDF Detected: ' + file.name + ']\nPlease review or paste your resume text below, or configure a Gemini API key in Settings for Vision OCR.\n\n' + (userData.cvText || PRESET_CVS.software),
          file.name,
          'Scanned PDF detected - please verify text below'
        );
      }
    } else if (['png', 'jpg', 'jpeg'].includes(ext) || file.type.startsWith('image/')) {
      statusText.textContent = 'Compressing image in browser & extracting text...';
      const compressedDataUrl = await shrinkImageInBrowser(file, 1200, 0.8);
      const apiKey = safeStorage.getItem(KEYS.API_KEY);
      if (apiKey) {
        statusText.textContent = 'Reading resume image with Gemini Flash Vision...';
        const ocrText = await callGeminiVisionOCR(compressedDataUrl, apiKey);
        applyExtractedCvText(ocrText, file.name, 'Extracted from compressed image via Gemini Vision');
      } else {
        const existingOrSample = userData.cvText && userData.cvText.trim().length > 20 ? userData.cvText : PRESET_CVS.software;
        applyExtractedCvText(existingOrSample, file.name, 'Image "' + file.name + '" compressed in browser - review & edit extracted text below');
        showToast('Image compressed! Review and edit the resume text in the editor.', 'info');
      }
    }
  } catch (err) {
    console.error(err);
    showToast('Could not read file automatically. You can paste or edit your CV text directly.', 'error');
  } finally {
    statusBox.classList.add('hidden');
  }
}

async function extractTextFromPDF(file) {
  if (!window.pdfjsLib) throw new Error('PDF.js not loaded');
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const maxPages = Math.min(pdf.numPages, 3);
  let fullText = '';
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items.map(function(item) { return item.str; });
    fullText += strings.join(' ') + '\n\n';
  }
  return fullText.replace(/\s+/g, ' ').replace(/([.?!])\s+/g, '$1\n').trim();
}

function shrinkImageInBrowser(file, maxDim, quality) {
  maxDim = maxDim || 1200;
  quality = quality || 0.8;
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function callGeminiVisionOCR(dataUrl, apiKey) {
  const base64Data = dataUrl.split(',')[1];
  const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: 'Extract all text from this resume image accurately. Preserve headings and bullet points. Do not invent any text.' },
          { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
        ]
      }]
    })
  });
  if (!resp.ok) throw new Error('Gemini OCR request failed');
  const data = await resp.json();
  return (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) || '';
}

function applyExtractedCvText(text, fileName, statusNote) {
  userData.cvText = text.trim();
  userData.cvFileName = fileName;
  userData.cvUpdatedAt = new Date().toISOString();
  saveUserWorkspace();

  document.getElementById('cvTextEditor').value = userData.cvText;
  document.getElementById('cvMetaStatus').textContent = statusNote || ('Loaded ' + fileName);
  refreshAllUI();
  showToast('Resume loaded (' + countWords(userData.cvText) + ' words). Review & edit before scanning.', 'success');
}

function handleCvEditorInput() {
  const val = document.getElementById('cvTextEditor').value;
  userData.cvText = val;
  userData.cvUpdatedAt = new Date().toISOString();
  saveUserWorkspace();
  updateCvWordCount();
}

function updateCvWordCount() {
  const editor = document.getElementById('cvTextEditor');
  const text = editor ? editor.value : '';
  const words = countWords(text);
  const badge = document.getElementById('cvWordCountBadge');
  if (badge) badge.textContent = words + ' words';
}

function countWords(str) {
  if (!str || !str.trim()) return 0;
  return str.trim().split(/\s+/).length;
}

function loadPresetCV(key) {
  const sample = PRESET_CVS[key];
  if (!sample) return;
  applyExtractedCvText(sample, 'Sample_' + key + '_CV.pdf', 'Loaded sample resume template - feel free to customize');
}

function loadSampleCVAndGo() {
  loadPresetCV('software');
  navigate('cv');
}

function scrubPersonalData() {
  const editor = document.getElementById('cvTextEditor');
  if (!editor.value.trim()) {
    showToast('Resume editor is empty.', 'info');
    return;
  }
  const scrubbed = editor.value
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL REDACTED]')
    .replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g, '[PHONE REDACTED]');
  editor.value = scrubbed;
  handleCvEditorInput();
  showToast('Redacted email addresses and phone numbers for privacy.', 'success');
}

function deleteMyCV() {
  if (!userData.cvText) {
    showToast('No CV stored to delete.', 'info');
    return;
  }
  userData.cvText = '';
  userData.cvFileName = '';
  userData.cvUpdatedAt = null;
  saveUserWorkspace();
  document.getElementById('cvTextEditor').value = '';
  refreshAllUI();
  showToast('Your CV has been permanently deleted from your workspace.', 'info');
}

function saveCvManually() {
  handleCvEditorInput();
  refreshAllUI();
  showToast('Resume saved and synced.', 'success');
}

function saveCvAndProceed() {
  handleCvEditorInput();
  if (!userData.cvText || userData.cvText.trim().length < 20) {
    showToast('Please upload or paste your CV text before proceeding.', 'error');
    return;
  }
  navigate('match');
}

// =========================================================================
// JOB MATCH & SKILL-GAP ANALYSIS ENGINE
// =========================================================================
function loadJobPreset(key) {
  const job = PRESET_JOBS[key];
  if (!job) return;
  document.getElementById('jobTitleInput').value = job.title;
  document.getElementById('jobCompanyInput').value = job.company;
  document.getElementById('jobDescInput').value = job.desc;
  document.getElementById('rescanSelect').value = '';
  showToast('Loaded "' + job.title + '" preset. You can customize any text before scanning.', 'info');
}

function clearJobForm() {
  document.getElementById('jobTitleInput').value = '';
  document.getElementById('jobCompanyInput').value = '';
  document.getElementById('jobDescInput').value = '';
  document.getElementById('rescanSelect').value = '';
}

function populateRescanDropdown() {
  const sel = document.getElementById('rescanSelect');
  if (!sel || !userData) return;
  const currentVal = sel.value;
  const uniqueJobs = [];
  const seen = new Set();
  userData.scans.forEach(function(s) {
    const key = s.jobTitle.toLowerCase() + '::' + s.company.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueJobs.push(s);
    }
  });

  sel.innerHTML = '<option value="">-- New Job Application --</option>' +
    uniqueJobs.map(function(s) {
      return '<option value="' + s.id + '">Re-Scan: ' + escapeHtml(s.jobTitle) + ' @ ' + escapeHtml(s.company) + ' (Last: ' + s.score + '%)</option>';
    }).join('');
  sel.value = currentVal;
}

function handleRescanPresetSelect() {
  const scanId = document.getElementById('rescanSelect').value;
  if (!scanId) return;
  const scan = userData.scans.find(function(s) { return s.id === scanId; });
  if (!scan) return;
  document.getElementById('jobTitleInput').value = scan.jobTitle;
  document.getElementById('jobCompanyInput').value = scan.company;
  document.getElementById('jobDescInput').value = scan.jdText;
  document.getElementById('studyHoursInput').value = scan.studyHours || 8;
  document.getElementById('studyHoursBadge').textContent = (scan.studyHours || 8) + ' hrs / week';
  showToast('Loaded "' + scan.jobTitle + '" for before-and-after Re-Scan comparison.', 'info');
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(36);
}

async function runFullMatchAnalysis() {
  const cvText = (userData.cvText || '').trim();
  if (cvText.length < 20) {
    showToast('Please add your resume in Resume Studio first!', 'info');
    navigate('cv');
    return;
  }

  const jobTitle = document.getElementById('jobTitleInput').value.trim() || 'Target Role';
  const company = document.getElementById('jobCompanyInput').value.trim() || 'Target Company';
  const jdText = document.getElementById('jobDescInput').value.trim();
  const studyHours = parseInt(document.getElementById('studyHoursInput').value, 10) || 8;

  if (jdText.length < 25) {
    showToast('Please paste a job description (or click one of the example presets on the right).', 'error');
    return;
  }

  const cacheKey = simpleHash(cvText + ':::' + jdText + ':::' + studyHours);
  if (userData.cache[cacheKey]) {
    const cachedScan = JSON.parse(JSON.stringify(userData.cache[cacheKey]));
    cachedScan.fromCache = true;
    userData.activeScanId = cachedScan.id;
    if (!userData.scans.find(function(s) { return s.id === cachedScan.id; })) {
      userData.scans.unshift(cachedScan);
    }
    saveUserWorkspace();
    refreshAllUI();
    navigate('results');
    showToast('Loaded identical CV + Job match from Smart Cache (0 quota used).', 'success');
    return;
  }

  if (userData.quota.used >= userData.quota.limit) {
    showToast('Daily scan limit (15/15) reached. Cached scans remain available.', 'error');
    return;
  }

  const btn = document.getElementById('runMatchBtn');
  const originalBtnHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Analyzing Fit, Rewriting Bullets &amp; Building Roadmap...</span>';

  try {
    const previousScan = userData.scans.find(function(s) {
      return s.jobTitle.toLowerCase() === jobTitle.toLowerCase() && s.company.toLowerCase() === company.toLowerCase();
    });

    let analysisResult = null;
    const apiKey = safeStorage.getItem(KEYS.API_KEY);

    if (apiKey) {
      try {
        analysisResult = await runGeminiCloudPipeline(cvText, jobTitle, company, jdText, studyHours, apiKey);
      } catch (cloudErr) {
        console.warn('Gemini API fallback to Smart Local Engine:', cloudErr);
      }
    }

    if (!analysisResult) {
      await new Promise(function(r) { setTimeout(r, 400); });
      analysisResult = runSmartLocalEngine(cvText, jobTitle, company, jdText, studyHours);
    }

    userData.quota.used += 1;

    const scanRecord = {
      id: 'scan_' + Date.now(),
      jobTitle: jobTitle,
      company: company,
      jdText: jdText,
      studyHours: studyHours,
      score: analysisResult.score,
      previousScore: previousScan ? previousScan.score : null,
      verdict: analysisResult.verdict,
      matchedSkills: analysisResult.matchedSkills,
      missingMust: analysisResult.missingMust,
      missingNice: analysisResult.missingNice,
      rewrites: analysisResult.rewrites,
      roadmap: analysisResult.roadmap,
      fromCache: false,
      timestamp: new Date().toISOString()
    };

    userData.scans.unshift(scanRecord);
    userData.activeScanId = scanRecord.id;
    userData.cache[cacheKey] = scanRecord;

    upsertApplicationFromScan(scanRecord);

    saveUserWorkspace();
    refreshAllUI();
    navigate('results');
    showToast('Analysis complete! Match Score: ' + scanRecord.score + '/100', 'success');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
  }
}

function runSmartLocalEngine(cvText, jobTitle, company, jdText, studyHours) {
  const cvLower = cvText.toLowerCase();
  const jdLower = jdText.toLowerCase();

  const niceIndex = jdLower.search(/nice-to-have|nice to have|preferred|bonus|good to have|plus/);
  const mustSection = niceIndex !== -1 ? jdLower.slice(0, niceIndex) : jdLower;
  const niceSection = niceIndex !== -1 ? jdLower.slice(niceIndex) : '';

  const matchedSkills = [];
  const missingMust = [];
  const missingNice = [];
  const detectedSkillNames = new Set();

  SKILL_CATALOG.forEach(function(skill) {
    const inMust = skill.aliases.some(function(alias) { return containsWholeTerm(mustSection, alias); });
    const inNice = skill.aliases.some(function(alias) { return containsWholeTerm(niceSection, alias); });
    if (!inMust && !inNice) return;

    detectedSkillNames.add(skill.name.toLowerCase());
    const userHasIt = skill.aliases.some(function(alias) { return containsWholeTerm(cvLower, alias); });

    if (userHasIt) {
      matchedSkills.push(skill.name);
    } else if (inMust) {
      missingMust.push(skill.name);
    } else {
      missingNice.push(skill.name);
    }
  });

  const customCandidates = extractCustomSkillsFromJD(jdText, detectedSkillNames);
  customCandidates.forEach(function(cand, idx) {
    const userHasCand = containsWholeTerm(cvLower, cand.toLowerCase());
    if (userHasCand) {
      matchedSkills.push(cand);
    } else if (idx % 3 !== 2) {
      missingMust.push(cand);
    } else {
      missingNice.push(cand);
    }
  });

  if (matchedSkills.length === 0 && missingMust.length === 0 && missingNice.length === 0) {
    ['Problem Solving', 'Communication', 'Project Management', 'Analytical Thinking', 'Technical Documentation'].forEach(function(fallbackSkill, i) {
      if (cvLower.includes(fallbackSkill.toLowerCase().split(' ')[0])) {
        matchedSkills.push(fallbackSkill);
      } else if (i < 3) {
        missingMust.push(fallbackSkill);
      } else {
        missingNice.push(fallbackSkill);
      }
    });
  }

  const totalWeight = (matchedSkills.length * 1.0) + (missingMust.length * 1.15) + (missingNice.length * 0.55);
  let rawScore = totalWeight > 0 ? Math.round(((matchedSkills.length * 1.0) / totalWeight) * 88) : 55;

  const hasMetrics = /\b\d+%|\b\d+x|\b\d+\+|\b\d{2,}\b/.test(cvText);
  const wordCountBonus = countWords(cvText) > 80 ? 5 : 2;
  rawScore = Math.min(96, Math.max(24, rawScore + (hasMetrics ? 7 : 2) + wordCountBonus));

  let verdict = '';
  if (rawScore >= 78) {
    verdict = 'Strong alignment for ' + jobTitle + ' at ' + company + '. You cover ' + matchedSkills.length + ' required skills. Focus on tightening weak bullet points and completing the remaining ' + (missingMust.length + missingNice.length) + ' skill modules.';
  } else if (rawScore >= 52) {
    verdict = 'Moderate fit (' + rawScore + '/100). You already bring ' + matchedSkills.length + ' relevant skills (' + (matchedSkills.slice(0, 4).join(', ') || 'foundational experience') + '), but lack ' + missingMust.length + ' must-have requirements (' + (missingMust.slice(0, 3).join(', ') || 'core tools') + '). Follow the roadmap below and re-scan.';
  } else {
    verdict = 'Significant skill gap detected (' + rawScore + '/100). The role requires ' + missingMust.length + ' core skills not currently listed on your CV. Use the truthful bullet rewrites and complete the prioritized weekly roadmap to boost your fit.';
  }

  const rewrites = generateTruthfulRewrites(cvText, jobTitle, matchedSkills);
  const roadmap = generateLearningRoadmap(missingMust, missingNice, studyHours, jobTitle);

  return {
    score: rawScore,
    verdict: verdict,
    matchedSkills: matchedSkills,
    missingMust: missingMust,
    missingNice: missingNice,
    rewrites: rewrites,
    roadmap: roadmap
  };
}

function containsWholeTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i');
  return regex.test(text);
}

function extractCustomSkillsFromJD(jdText, alreadyDetectedSet) {
  const stopWords = new Set([
    'About', 'Role', 'Company', 'Team', 'Experience', 'Work', 'Working', 'Skills', 'Required',
    'Preferred', 'Must', 'Have', 'Nice', 'Qualifications', 'Responsibilities', 'Requirements',
    'Location', 'Full', 'Time', 'Part', 'Intern', 'Internship', 'Junior', 'Senior', 'Lead',
    'Associate', 'Manager', 'Engineer', 'Developer', 'Analyst', 'Strong', 'Good', 'Great',
    'Ability', 'Knowledge', 'Understanding', 'Familiarity', 'Proven', 'Track', 'Record',
    'Bachelor', 'Degree', 'Computer', 'Science', 'Engineering', 'Related', 'Field', 'Plus',
    'With', 'From', 'This', 'That', 'Your', 'Will', 'What', 'Where', 'When', 'Join', 'Build'
  ]);

  const matches = jdText.match(/\b[A-Z][A-Za-z0-9+#./-]{2,18}(?:\s[A-Z][A-Za-z0-9+#./-]{2,18})?\b/g) || [];
  const counts = {};
  matches.forEach(function(m) {
    const clean = m.trim().replace(/[.,:;()]+$/, '');
    if (clean.length < 3) return;
    if (stopWords.has(clean) || stopWords.has(clean.split(' ')[0])) return;
    if (alreadyDetectedSet.has(clean.toLowerCase())) return;
    counts[clean] = (counts[clean] || 0) + 1;
  });

  return Object.keys(counts)
    .filter(function(k) { return alreadyDetectedSet.size < 5 || counts[k] >= 1; })
    .slice(0, 6);
}

function generateTruthfulRewrites(cvText, jobTitle, matchedSkills) {
  const lines = cvText
    .split(/\n+/)
    .map(function(l) { return l.trim().replace(/^[-*]\s*/, ''); })
    .filter(function(l) { return l.length > 28 && l.length < 240 && !/^(summary|skills|technical skills|education|projects|experience|contact)/i.test(l); });

  const targetLines = lines.slice(0, 4);
  const actionVerbs = ['Engineered', 'Spearheaded', 'Architected', 'Optimized', 'Delivered', 'Streamlined'];
  const skillContext = matchedSkills.length > 0 ? matchedSkills.slice(0, 2).join(' and ') : 'structured workflows';

  if (targetLines.length === 0) {
    return [{
      original: 'Worked on academic and personal projects related to the role.',
      rewritten: 'Delivered end-to-end projects leveraging ' + skillContext + ', documenting technical decisions and validating outcomes against ' + jobTitle + ' standards.',
      reason: 'Replaces vague phrasing ("Worked on") with active ownership while remaining 100% truthful to your background.'
    }];
  }

  return targetLines.map(function(orig, idx) {
    let improved = orig
      .replace(/^(worked on|helped with|helped|responsible for|assisted with|assisted in|participated in|was involved in)\s+/i, '')
      .trim();
    improved = improved.charAt(0).toLowerCase() + improved.slice(1).replace(/\.$/, '');

    const verb = actionVerbs[idx % actionVerbs.length];
    const rewritten = verb + ' and refined ' + improved + ', applying structured best practices to improve reliability and maintainability.';

    return {
      original: orig,
      rewritten: rewritten,
      reason: 'Replaces passive wording with strong action-oriented phrasing tailored for ' + jobTitle + ' without inventing unverified skills.'
    };
  });
}

function generateLearningRoadmap(missingMust, missingNice, studyHours, jobTitle) {
  const allOrdered = []
    .concat(missingMust.map(function(s) { return { name: s, priority: 'Must-Have' }; }))
    .concat(missingNice.map(function(s) { return { name: s, priority: 'Nice-to-Have' }; }));

  if (allOrdered.length === 0) {
    allOrdered.push({
      name: 'System Design & Interview Readiness',
      priority: 'Must-Have'
    });
  }

  const hoursPerSkill = Math.max(4, Math.min(12, Math.round(studyHours * 0.85)));
  let currentHoursAccumulator = 0;

  return allOrdered.map(function(item, index) {
    const catalogEntry = SKILL_CATALOG.find(function(c) { return c.name.toLowerCase() === item.name.toLowerCase(); });
    const weekNumber = Math.floor(currentHoursAccumulator / studyHours) + 1;
    currentHoursAccumulator += hoursPerSkill;

    const projectIdea = catalogEntry
      ? catalogEntry.project
      : 'Build a focused mini-project demonstrating ' + item.name + ' for a ' + jobTitle + ' portfolio and document it in your CV.';

    const searchQuery = catalogEntry
      ? catalogEntry.query
      : item.name + ' full tutorial freeCodeCamp Coursera official docs';

    return {
      id: 'mod_' + index + '_' + Date.now(),
      week: weekNumber,
      skill: item.name,
      priority: item.priority,
      estimatedHours: hoursPerSkill,
      project: projectIdea,
      searchQuery: searchQuery,
      steps: [
        { id: 's_' + index + '_1', text: 'Study core concepts, syntax, and architecture of ' + item.name + ' (' + Math.ceil(hoursPerSkill * 0.35) + ' hrs)', done: false },
        { id: 's_' + index + '_2', text: 'Complete guided hands-on exercises and debug common edge cases in ' + item.name + ' (' + Math.ceil(hoursPerSkill * 0.3) + ' hrs)', done: false },
        { id: 's_' + index + '_3', text: 'Build CV Practice Project: ' + projectIdea + ' (' + Math.ceil(hoursPerSkill * 0.35) + ' hrs)', done: false }
      ]
    };
  });
}

async function runGeminiCloudPipeline(cvText, jobTitle, company, jdText, studyHours, apiKey) {
  const prompt = 'You are ResumeFit, an honest career analysis engine.\n' +
    'Analyze the candidate CV against the Job Description for "' + jobTitle + '" at "' + company + '".\n' +
    'Candidate Weekly Study Hours: ' + studyHours + '.\n' +
    'Honesty rules:\n' +
    '- Never invent skills the candidate does not have in rewrites.\n' +
    '- Never invent URLs; provide search queries for free platforms instead.\n' +
    'Reply ONLY in valid JSON matching this schema:\n' +
    '{\n' +
    '  "score": 75,\n' +
    '  "verdict": "string",\n' +
    '  "matchedSkills": ["string"],\n' +
    '  "missingMust": ["string"],\n' +
    '  "missingNice": ["string"],\n' +
    '  "rewrites": [{"original": "string", "rewritten": "string", "reason": "string"}],\n' +
    '  "roadmap": [{\n' +
    '    "week": 1,\n' +
    '    "skill": "string",\n' +
    '    "priority": "Must-Have",\n' +
    '    "estimatedHours": 6,\n' +
    '    "project": "string",\n' +
    '    "searchQuery": "string",\n' +
    '    "steps": [{"id": "s1", "text": "string", "done": false}]\n' +
    '  }]\n' +
    '}\n\n' +
    'CV TEXT:\n' + cvText.slice(0, 3500) + '\n\n' +
    'JOB DESCRIPTION:\n' + jdText.slice(0, 3500);

  const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });

  if (resp.status === 429) {
    showToast('Gemini API rate limit (429) reached - switched to Smart Local Engine.', 'info');
    throw new Error('Rate limited');
  }
  if (!resp.ok) throw new Error('Gemini API error');
  const data = await resp.json();
  const rawJson = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text;
  const parsed = JSON.parse(rawJson);
  if (typeof parsed.score !== 'number' || !Array.isArray(parsed.roadmap)) {
    throw new Error('Malformed JSON');
  }
  return parsed;
}

// =========================================================================
// RENDER VIEWS (RESULTS, ROADMAP, PROGRESS, TRACKER)
// =========================================================================
function renderMatchResultsView() {
  const scan = getActiveScan();
  const emptyEl = document.getElementById('resultsEmptyState');
  const contentEl = document.getElementById('resultsContent');

  if (!scan) {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  document.getElementById('resRoleBadge').textContent = scan.jobTitle;
  document.getElementById('resCompanyBadge').textContent = scan.company;

  const cacheBadge = document.getElementById('resCacheBadge');
  if (scan.fromCache) cacheBadge.classList.remove('hidden');
  else cacheBadge.classList.add('hidden');

  const circle = document.getElementById('scoreRingCircle');
  const circumference = 314;
  const offset = circumference - (scan.score / 100) * circumference;
  circle.style.strokeDashoffset = offset;

  if (scan.score >= 75) {
    circle.setAttribute('class', 'text-emerald-500 transition-all duration-700');
  } else if (scan.score >= 50) {
    circle.setAttribute('class', 'text-amber-500 transition-all duration-700');
  } else {
    circle.setAttribute('class', 'text-rose-500 transition-all duration-700');
  }

  document.getElementById('resScoreNumber').textContent = scan.score;
  document.getElementById('resScoreVerdict').textContent = scan.verdict;

  const deltaBadge = document.getElementById('resDeltaBadge');
  if (typeof scan.previousScore === 'number') {
    const diff = scan.score - scan.previousScore;
    deltaBadge.classList.remove('hidden');
    const sign = diff >= 0 ? '+' : '';
    deltaBadge.textContent = sign + diff + ' pts vs previous scan (' + scan.previousScore + '% -> ' + scan.score + '%)';
  } else {
    deltaBadge.classList.add('hidden');
  }

  document.getElementById('countMatchedSkills').textContent = scan.matchedSkills.length;
  document.getElementById('countMustSkills').textContent = scan.missingMust.length;
  document.getElementById('countNiceSkills').textContent = scan.missingNice.length;

  document.getElementById('matchedSkillsContainer').innerHTML = scan.matchedSkills.length
    ? scan.matchedSkills.map(function(s) {
        return '<span class="px-3 py-1 rounded-xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 flex items-center gap-1.5"><i class="fa-solid fa-check text-[10px]"></i>' + escapeHtml(s) + '</span>';
      }).join('')
    : '<span class="text-xs text-slate-400">No direct skill matches detected yet.</span>';

  document.getElementById('missingMustContainer').innerHTML = scan.missingMust.length
    ? scan.missingMust.map(function(s) {
        return '<span class="px-3 py-1 rounded-xl text-xs font-semibold bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80 flex items-center gap-1.5"><i class="fa-solid fa-xmark text-[10px]"></i>' + escapeHtml(s) + '</span>';
      }).join('')
    : '<span class="text-xs text-emerald-600 dark:text-emerald-400 font-medium">All must-have skills covered!</span>';

  document.getElementById('missingNiceContainer').innerHTML = scan.missingNice.length
    ? scan.missingNice.map(function(s) {
        return '<span class="px-3 py-1 rounded-xl text-xs font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80">' + escapeHtml(s) + '</span>';
      }).join('')
    : '<span class="text-xs text-emerald-600 dark:text-emerald-400 font-medium">All preferred skills covered!</span>';

  const rewritesEl = document.getElementById('rewritesContainer');
  rewritesEl.innerHTML = (scan.rewrites || []).map(function(rw, idx) {
    return '<div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div class="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200/70 dark:border-rose-900/50">' +
          '<span class="text-[10px] font-bold uppercase tracking-wider text-rose-500 block mb-1">Original CV Line</span>' +
          '<p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">' + escapeHtml(rw.original) + '</p>' +
        '</div>' +
        '<div class="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-900/60">' +
          '<span class="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-1">Tailored &amp; Truthful Rewrite</span>' +
          '<p class="text-xs font-medium text-slate-900 dark:text-white leading-relaxed">' + escapeHtml(rw.rewritten) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="flex flex-wrap items-center justify-between gap-2 pt-1">' +
        '<span class="text-[11px] text-slate-500 dark:text-slate-400"><i class="fa-regular fa-lightbulb text-amber-500 mr-1"></i>' + escapeHtml(rw.reason || '') + '</span>' +
        '<button type="button" onclick="applyRewriteToCV(' + idx + ')" class="px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold transition flex items-center gap-1.5">' +
          '<i class="fa-solid fa-check"></i>' +
          '<span>Use This Rewrite in My CV</span>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  renderSkillGapChart(scan);
}

function applyRewriteToCV(rewriteIndex) {
  const scan = getActiveScan();
  if (!scan || !scan.rewrites || !scan.rewrites[rewriteIndex]) return;
  const rw = scan.rewrites[rewriteIndex];

  if (userData.cvText.includes(rw.original)) {
    userData.cvText = userData.cvText.replace(rw.original, rw.rewritten);
  } else {
    userData.cvText = userData.cvText.trim() + '\n- ' + rw.rewritten;
  }
  userData.cvUpdatedAt = new Date().toISOString();
  saveUserWorkspace();
  refreshAllUI();
  showToast('Updated your CV with the tailored bullet point!', 'success');
}

function renderSkillGapChart(scan) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('skillGapChart');
  if (!ctx) return;
  if (skillGapChartInstance) skillGapChartInstance.destroy();

  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#cbd5e1' : '#475569';
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.25)';

  skillGapChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Matched Skills', 'Missing (Must-Have)', 'Missing (Nice-to-Have)'],
      datasets: [{
        label: 'Number of Skills',
        data: [scan.matchedSkills.length, scan.missingMust.length, scan.missingNice.length],
        backgroundColor: [
          'rgba(16, 185, 129, 0.85)',
          'rgba(244, 63, 94, 0.85)',
          'rgba(245, 158, 11, 0.85)'
        ],
        borderRadius: 10,
        barThickness: 38
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1, color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font: { weight: '600' } }, grid: { display: false } }
      }
    }
  });
}

function calculateRoadmapProgress(scan) {
  if (!scan || !Array.isArray(scan.roadmap)) return { done: 0, total: 0, pct: 0 };
  let done = 0;
  let total = 0;
  scan.roadmap.forEach(function(mod) {
    (mod.steps || []).forEach(function(st) {
      total += 1;
      if (st.done) done += 1;
    });
  });
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done: done, total: total, pct: pct };
}

function renderRoadmapView() {
  const scan = getActiveScan();
  const emptyEl = document.getElementById('roadmapEmptyState');
  const contentEl = document.getElementById('roadmapContent');

  if (!scan || !Array.isArray(scan.roadmap)) {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  document.getElementById('roadmapHoursTag').textContent = (scan.studyHours || 8) + ' hrs / week pace';
  document.getElementById('roadmapSubheader').textContent = 'Target Role: ' + scan.jobTitle + ' @ ' + scan.company + ' - Tick off all 3 steps in a skill module to mark it complete, then add it to your CV and re-scan!';

  const prog = calculateRoadmapProgress(scan);
  document.getElementById('roadmapProgressText').textContent = prog.pct + '% (' + prog.done + ' / ' + prog.total + ' steps completed)';
  document.getElementById('roadmapProgressBar').style.width = prog.pct + '%';

  const container = document.getElementById('roadmapModulesContainer');
  container.innerHTML = scan.roadmap.map(function(mod, mIdx) {
    const isMust = mod.priority === 'Must-Have';
    const badgeClass = isMust
      ? 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
      : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';

    const stepsArr = mod.steps || [];
    const doneCount = stepsArr.filter(function(st) { return st.done; }).length;
    const allDone = stepsArr.length > 0 && doneCount === stepsArr.length;
    const statusBadge = allDone
      ? '<span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><i class="fa-solid fa-check mr-1"></i>Module Complete &mdash; Ready for CV</span>'
      : '<span class="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">' + doneCount + ' / ' + stepsArr.length + ' steps ticked</span>';

    const ytUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(mod.searchQuery);
    const googleUrl = 'https://www.google.com/search?q=' + encodeURIComponent(mod.searchQuery);

    const stepsHtml = stepsArr.map(function(st, sIdx) {
      const checkedAttr = st.done ? 'checked' : '';
      const textCls = st.done ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200 font-medium';
      return '<label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition">' +
        '<input type="checkbox" ' + checkedAttr + ' onchange="toggleRoadmapStep(' + mIdx + ', ' + sIdx + ')" class="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />' +
        '<span class="text-xs sm:text-sm ' + textCls + '">' + escapeHtml(st.text) + '</span>' +
      '</label>';
    }).join('');

    return '<div class="bg-white dark:bg-slate-900 rounded-2xl border ' + (allDone ? 'border-emerald-400 dark:border-emerald-700' : 'border-slate-200/80 dark:border-slate-800') + ' p-6 shadow-sm space-y-4">' +
      '<div class="flex flex-wrap items-center justify-between gap-2">' +
        '<div class="flex flex-wrap items-center gap-2.5">' +
          '<span class="px-3 py-1 rounded-xl bg-brand-600 text-white text-xs font-extrabold">Week ' + mod.week + '</span>' +
          '<h3 class="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">' + escapeHtml(mod.skill) + '</h3>' +
          '<span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full border ' + badgeClass + '">' + escapeHtml(mod.priority) + '</span>' +
          statusBadge +
        '</div>' +
        '<span class="text-xs font-semibold text-slate-500 dark:text-slate-400"><i class="fa-regular fa-clock mr-1"></i>~' + mod.estimatedHours + ' study hrs</span>' +
      '</div>' +
      '<div class="space-y-2">' + stepsHtml + '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">' +
        '<div class="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/50">' +
          '<span class="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block mb-1">' +
            '<i class="fa-solid fa-code-branch mr-1"></i>Practice Project to Add to CV' +
          '</span>' +
          '<p class="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">' + escapeHtml(mod.project) + '</p>' +
        '</div>' +
        '<div class="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 flex flex-col justify-between">' +
          '<div>' +
            '<span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">' +
              '<i class="fa-solid fa-magnifying-glass mr-1"></i>Recommended Free Study Search' +
            '</span>' +
            '<p class="text-xs font-mono text-brand-600 dark:text-brand-400 truncate">"' + escapeHtml(mod.searchQuery) + '"</p>' +
          '</div>' +
          '<div class="flex items-center gap-2 mt-2.5">' +
            '<a href="' + ytUrl + '" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-300 text-[11px] font-semibold hover:underline flex items-center gap-1">' +
              '<i class="fa-brands fa-youtube"></i> YouTube / freeCodeCamp' +
            '</a>' +
            '<a href="' + googleUrl + '" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-brand-50 dark:bg-brand-950/70 text-brand-600 dark:text-brand-300 text-[11px] font-semibold hover:underline flex items-center gap-1">' +
              '<i class="fa-brands fa-google"></i> Docs &amp; Coursera' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleRoadmapStep(modIdx, stepIdx) {
  const scan = getActiveScan();
  if (!scan || !scan.roadmap || !scan.roadmap[modIdx] || !scan.roadmap[modIdx].steps[stepIdx]) return;
  const step = scan.roadmap[modIdx].steps[stepIdx];
  step.done = !step.done;
  saveUserWorkspace();
  refreshAllUI();
}

function syncCompletedSkillsToCV() {
  const scan = getActiveScan();
  if (!scan || !Array.isArray(scan.roadmap)) return;

  // Only include skill modules where ALL steps have been checked off by the user
  const fullyCompletedModules = scan.roadmap.filter(function(mod) {
    return Array.isArray(mod.steps) && mod.steps.length > 0 && mod.steps.every(function(st) { return st.done; });
  });

  const partiallyCompletedModules = scan.roadmap.filter(function(mod) {
    const someDone = Array.isArray(mod.steps) && mod.steps.some(function(st) { return st.done; });
    const allDone = Array.isArray(mod.steps) && mod.steps.length > 0 && mod.steps.every(function(st) { return st.done; });
    return someDone && !allDone;
  });

  if (fullyCompletedModules.length === 0) {
    if (partiallyCompletedModules.length > 0) {
      showToast('Please tick off all 3 steps in "' + partiallyCompletedModules[0].skill + '" to complete the module before adding it to your CV.', 'error');
    } else {
      showToast('Please tick off all steps for at least one skill module before adding to your CV and re-scanning.', 'error');
    }
    return;
  }

  // Prevent duplicate appending of skills that were already synced to the CV
  const cvLower = (userData.cvText || '').toLowerCase();
  const newModulesToAdd = fullyCompletedModules.filter(function(m) {
    const projectMarker = ('Built ' + m.skill + ' Portfolio Project').toLowerCase();
    return !cvLower.includes(projectMarker);
  });

  if (newModulesToAdd.length === 0) {
    showToast('Those completed skills are already in your CV! Tick off another skill module first.', 'info');
    return;
  }

  const skillsAdded = newModulesToAdd.map(function(m) { return m.skill; });
  const projectsAdded = newModulesToAdd.map(function(m) { return '- Built ' + m.skill + ' Portfolio Project: ' + m.project; }).join('\n');

  userData.cvText = userData.cvText.trim() + '\n\nNEWLY COMPLETED SKILLS & PROJECTS\nSkills: ' + skillsAdded.join(', ') + '\n' + projectsAdded;
  userData.cvUpdatedAt = new Date().toISOString();
  saveUserWorkspace();
  showToast('Added "' + skillsAdded.join(', ') + '" to your CV! Running updated match scan...', 'success');

  document.getElementById('jobTitleInput').value = scan.jobTitle;
  document.getElementById('jobCompanyInput').value = scan.company;
  document.getElementById('jobDescInput').value = scan.jdText;
  document.getElementById('studyHoursInput').value = scan.studyHours || 8;
  runFullMatchAnalysis();
}

function triggerQuickRescan() {
  const scan = getActiveScan();
  if (!scan) {
    navigate('match');
    return;
  }
  document.getElementById('jobTitleInput').value = scan.jobTitle;
  document.getElementById('jobCompanyInput').value = scan.company;
  document.getElementById('jobDescInput').value = scan.jdText;
  document.getElementById('studyHoursInput').value = scan.studyHours || 8;
  navigate('match');
  showToast('Ready to Re-Scan! Click "Check My Fit & Build Roadmap" to see your updated score.', 'info');
}

function renderProgressView() {
  renderProgressHistoryChart();

  const listEl = document.getElementById('scanHistoryList');
  if (!listEl || !userData) return;

  if (userData.scans.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">No scans recorded yet. Run your first job match to start tracking score improvements.</p>';
    return;
  }

  listEl.innerHTML = userData.scans.map(function(s) {
    const deltaHtml = typeof s.previousScore === 'number'
      ? '<span class="text-xs font-semibold text-emerald-600 dark:text-emerald-400">' + s.previousScore + '% &rarr; ' + s.score + '%</span>'
      : '';
    return '<div onclick="selectScanAndView(\'' + s.id + '\')" class="cursor-pointer p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 hover:border-brand-500 transition flex items-center justify-between">' +
      '<div>' +
        '<p class="text-sm font-bold text-slate-900 dark:text-white">' + escapeHtml(s.jobTitle) + ' <span class="text-slate-400 font-normal">@ ' + escapeHtml(s.company) + '</span></p>' +
        '<p class="text-xs text-slate-500 dark:text-slate-400">' + new Date(s.timestamp).toLocaleString() + ' &bull; ' + s.matchedSkills.length + ' matched, ' + (s.missingMust.length + s.missingNice.length) + ' missing</p>' +
      '</div>' +
      '<div class="flex items-center gap-3">' +
        deltaHtml +
        '<span class="px-3 py-1 rounded-xl font-extrabold text-xs bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300">' + s.score + '/100</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderProgressHistoryChart() {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('progressHistoryChart');
  if (!ctx || !userData) return;
  if (progressChartInstance) progressChartInstance.destroy();

  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#cbd5e1' : '#475569';
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.25)';

  const chronological = userData.scans.slice().reverse();
  const labels = chronological.length
    ? chronological.map(function(s, idx) { return 'Scan #' + (idx + 1) + ': ' + s.jobTitle.slice(0, 18); })
    : ['Initial Scan (Example)', 'After Bullet Rewrites', 'After Roadmap Project'];
  const scores = chronological.length
    ? chronological.map(function(s) { return s.score; })
    : [52, 66, 81];

  progressChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: chronological.length ? 'Your Match Score History' : 'Sample Improvement Trajectory (Run scans to populate)',
        data: scores,
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79, 70, 229, 0.15)',
        borderWidth: 3,
        pointBackgroundColor: '#4f46e5',
        pointRadius: 5,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, ticks: { color: textColor }, grid: { color: gridColor } },
        x: { ticks: { color: textColor }, grid: { display: false } }
      },
      plugins: {
        legend: { labels: { color: textColor, font: { weight: '600' } } }
      }
    }
  });
}

function renderDashboardRecentScans() {
  const el = document.getElementById('dashRecentScans');
  if (!el || !userData) return;

  if (userData.scans.length === 0) {
    el.innerHTML = '<div class="p-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">' +
      '<p class="text-xs text-slate-500 dark:text-slate-400">You have not run any job match scans yet.</p>' +
      '<button type="button" onclick="navigate(\'match\')" class="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold">Run Your First Job Match</button>' +
    '</div>';
    return;
  }

  el.innerHTML = userData.scans.slice(0, 4).map(function(s) {
    return '<div onclick="selectScanAndView(\'' + s.id + '\')" class="cursor-pointer p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 hover:border-brand-500 transition flex items-center justify-between">' +
      '<div class="min-w-0">' +
        '<p class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">' + escapeHtml(s.jobTitle) + ' <span class="font-normal text-slate-400">@ ' + escapeHtml(s.company) + '</span></p>' +
        '<p class="text-[11px] text-slate-500 dark:text-slate-400">' + s.matchedSkills.length + ' skills matched &bull; ' + s.missingMust.length + ' must-have missing</p>' +
      '</div>' +
      '<span class="px-2.5 py-1 rounded-lg font-extrabold text-xs bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 shrink-0 ml-2">' + s.score + '%</span>' +
    '</div>';
  }).join('');
}

function selectScanAndView(scanId) {
  userData.activeScanId = scanId;
  saveUserWorkspace();
  refreshAllUI();
  navigate('results');
}

function upsertApplicationFromScan(scan) {
  const existing = userData.applications.find(function(a) {
    return a.jobTitle.toLowerCase() === scan.jobTitle.toLowerCase() && a.company.toLowerCase() === scan.company.toLowerCase();
  });
  if (existing) {
    existing.score = scan.score;
    existing.scanId = scan.id;
    existing.date = new Date().toISOString().slice(0, 10);
  } else {
    userData.applications.unshift({
      id: 'app_' + Date.now(),
      jobTitle: scan.jobTitle,
      company: scan.company,
      score: scan.score,
      status: 'Saved',
      date: new Date().toISOString().slice(0, 10),
      scanId: scan.id
    });
  }
}

function filterTracker(status) {
  activeTrackerFilter = status;
  document.querySelectorAll('.tracker-filter-btn').forEach(function(btn) {
    if (btn.getAttribute('data-filter') === status) {
      btn.className = 'tracker-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-brand-600 text-white';
    } else {
      btn.className = 'tracker-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300';
    }
  });
  renderTrackerView();
}

function renderTrackerView() {
  const container = document.getElementById('trackerListContainer');
  if (!container || !userData) return;

  const filtered = activeTrackerFilter === 'All'
    ? userData.applications
    : userData.applications.filter(function(a) { return a.status === activeTrackerFilter; });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="p-10 text-center text-xs text-slate-400">No job applications in "' + activeTrackerFilter + '" status.</div>';
    return;
  }

  container.innerHTML = filtered.map(function(app) {
    const optionsHtml = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'].map(function(st) {
      const sel = app.status === st ? 'selected' : '';
      return '<option value="' + st + '" ' + sel + '>' + st + '</option>';
    }).join('');
    const reportBtn = app.scanId
      ? '<button type="button" onclick="selectScanAndView(\'' + app.scanId + '\')" class="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">Report</button>'
      : '';
    return '<div class="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">' +
      '<div>' +
        '<div class="flex items-center gap-2.5">' +
          '<h4 class="font-bold text-sm text-slate-900 dark:text-white">' + escapeHtml(app.jobTitle) + '</h4>' +
          '<span class="text-xs text-slate-400">&bull;</span>' +
          '<span class="text-xs font-semibold text-brand-600 dark:text-brand-400">' + escapeHtml(app.company) + '</span>' +
        '</div>' +
        '<p class="text-[11px] text-slate-400 mt-0.5">Last updated: ' + escapeHtml(app.date) + '</p>' +
      '</div>' +
      '<div class="flex flex-wrap items-center gap-3">' +
        '<span class="px-2.5 py-1 rounded-lg text-xs font-bold bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300">Fit: ' + app.score + '%</span>' +
        '<select onchange="updateTrackerStatus(\'' + app.id + '\', this.value)" class="text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-slate-800 dark:text-slate-200">' +
          optionsHtml +
        '</select>' +
        reportBtn +
        '<button type="button" onclick="deleteTrackerApp(\'' + app.id + '\')" class="text-slate-400 hover:text-rose-500 p-1" title="Remove">' +
          '<i class="fa-regular fa-trash-can text-xs"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function updateTrackerStatus(appId, newStatus) {
  const app = userData.applications.find(function(a) { return a.id === appId; });
  if (!app) return;
  app.status = newStatus;
  saveUserWorkspace();
  renderTrackerView();
  showToast('Updated "' + app.jobTitle + '" status to ' + newStatus + '.', 'success');
}

function deleteTrackerApp(appId) {
  userData.applications = userData.applications.filter(function(a) { return a.id !== appId; });
  saveUserWorkspace();
  refreshAllUI();
}

function openAddTrackerModal() {
  document.getElementById('addTrackerModal').classList.remove('hidden');
}

function closeAddTrackerModal() {
  document.getElementById('addTrackerModal').classList.add('hidden');
}

function handleAddManualApplication(e) {
  e.preventDefault();
  const jobTitle = document.getElementById('manualJobTitle').value.trim();
  const company = document.getElementById('manualJobCompany').value.trim();
  const score = parseInt(document.getElementById('manualJobScore').value, 10) || 75;
  const status = document.getElementById('manualJobStatus').value;

  userData.applications.unshift({
    id: 'app_' + Date.now(),
    jobTitle: jobTitle,
    company: company,
    score: score,
    status: status,
    date: new Date().toISOString().slice(0, 10),
    scanId: null
  });
  saveUserWorkspace();
  closeAddTrackerModal();
  refreshAllUI();
  showToast('Added "' + jobTitle + '" to Application Tracker.', 'success');
}

function openSettingsModal() {
  document.getElementById('geminiKeyInput').value = safeStorage.getItem(KEYS.API_KEY) || '';
  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function saveApiKey() {
  const val = document.getElementById('geminiKeyInput').value.trim();
  if (val) {
    safeStorage.setItem(KEYS.API_KEY, val);
    showToast('Saved Gemini API Key. Cloud + Local fallback active.', 'success');
  } else {
    safeStorage.removeItem(KEYS.API_KEY);
    showToast('Using built-in Smart Local Analysis Engine.', 'info');
  }
  closeSettingsModal();
  refreshAllUI();
}

function showToast(message, type) {
  type = type || 'info';
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const colors = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
    info: 'bg-slate-900 dark:bg-slate-800 text-white border border-slate-700'
  };
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    info: 'fa-circle-info'
  };

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto px-4 py-3 rounded-2xl shadow-lg text-xs font-semibold flex items-center gap-2.5 transition-all duration-300 ' + (colors[type] || colors.info);
  toast.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.info) + '"></i><span>' + escapeHtml(message) + '</span>';
  container.appendChild(toast);

  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3600);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}