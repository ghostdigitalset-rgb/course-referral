# ProSkills — Course Referral System

A complete course registration + referral tracking system built for Vercel.

## What's included

- **Registration page** — students register, referral link auto-tracked
- **Admin dashboard** — add/remove reps, view all students, export CSV
- **Sales rep portal** — reps log in with their code and see their own stats

---

## Deploy to Vercel (step by step)

### 1. Install Vercel CLI
```bash
npm install -g vercel
```

### 2. Login to Vercel
```bash
vercel login
```

### 3. Add Vercel KV storage
In your [Vercel dashboard](https://vercel.com/dashboard):
1. Go to **Storage** → **Create Database** → choose **KV**
2. Name it anything (e.g. `proskills-db`)
3. Click **Connect to Project** and select this project

This automatically adds the required `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables.

### 4. Set your admin password
In Vercel dashboard → your project → **Settings** → **Environment Variables**:
```
ADMIN_PASSWORD = your_secret_password_here
```

### 5. Install dependencies and deploy
```bash
npm install @vercel/kv
vercel --prod
```

---

## How to use

### You (admin)
1. Go to `yoursite.vercel.app/?page=admin`
2. Log in with your `ADMIN_PASSWORD`
3. Add your sales reps (name + phone)
4. Copy each rep's referral link and send it to them

### Your sales reps
1. They share their link (e.g. `yoursite.vercel.app/?ref=rep_12345`)
2. When a student registers via that link, it counts for them
3. They can check their stats at `yoursite.vercel.app/?page=rep`
4. They enter their rep code (the part after `?ref=` in their link) to log in

### Students
- Just visit the site (with or without a referral link) and fill in the form

---

## File structure

```
course-referral/
├── api/
│   ├── _store.js        # KV storage helpers
│   ├── admin.js         # Admin data endpoint
│   ├── reps.js          # Add/delete reps
│   ├── register.js      # Student registration
│   └── rep-stats.js     # Rep self-service stats
├── public/
│   └── index.html       # Full frontend (all pages)
├── package.json
└── vercel.json
```

---

## Local development

```bash
npm install @vercel/kv
vercel dev
```
