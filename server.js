const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'approve-it';
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

const LISTINGS_FILE = path.join(DATA_DIR, 'listings.json');
const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'subscribers.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const LIFETIME_MS = 5 * DAY_MS;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function readJson(filePath, fallback = []) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(contents || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function pruneListings() {
  const listings = readJson(LISTINGS_FILE, []);
  const now = Date.now();
  const filtered = listings.filter((listing) => now - listing.createdAt < LIFETIME_MS);
  if (filtered.length !== listings.length) {
    writeJson(LISTINGS_FILE, filtered);
  }
  return filtered;
}

function addListing(listing) {
  const listings = pruneListings();
  listings.push(listing);
  writeJson(LISTINGS_FILE, listings);
}

function updateListing(id, updater) {
  const listings = pruneListings();
  const updated = listings.map((listing) => {
    if (listing.id === id) {
      return updater({ ...listing });
    }
    return listing;
  });
  writeJson(LISTINGS_FILE, updated);
  return updated.find((listing) => listing.id === id);
}

function addSubscriber(email) {
  const subscribers = readJson(SUBSCRIBERS_FILE, []);
  if (!subscribers.includes(email)) {
    subscribers.push(email);
    writeJson(SUBSCRIBERS_FILE, subscribers);
  }
  return subscribers;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      const params = new URLSearchParams(data);
      const body = {};
      params.forEach((value, key) => {
        body[key] = value;
      });
      resolve(body);
    });
  });
}

function sendStatic(res, filePath) {
  const abs = path.join(PUBLIC_DIR, filePath);
  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(abs)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const ext = path.extname(abs);
  const contentType = ext === '.css' ? 'text/css' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(abs));
}

function layout({ title, content, message }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="topbar">
    <div class="branding">Homes in Pats</div>
    <nav>
      <a href="/">Home</a>
      <a href="/listings/new">Create listing</a>
      <a href="/admin">Admin</a>
    </nav>
  </header>
  <main class="container">
    ${message ? `<div class="flash">${escapeHtml(message)}</div>` : ''}
    ${content}
  </main>
  <footer class="footer">Listings disappear after 5 days. Stay current!</footer>
</body>
</html>`;
}

function listingCard(listing, subscribersCount) {
  const daysLeft = Math.max(0, Math.ceil((listing.createdAt + LIFETIME_MS - Date.now()) / DAY_MS));
  const statusLabel = listing.status === 'approved' ? 'Live' : 'Pending admin approval';
  return `<article class="card">
    <div class="card-header">
      <h3>${escapeHtml(listing.title || 'Untitled listing')}</h3>
      <span class="status ${listing.status}">${statusLabel}</span>
    </div>
    <p class="meta">${escapeHtml(listing.location || 'No location specified')} &bull; ${escapeHtml(listing.price || 'Price on request')}</p>
    <p>${escapeHtml(listing.description || 'No description provided.')}</p>
    <p class="meta">Posted by ${escapeHtml(listing.contactName || 'Unknown')} (${escapeHtml(listing.role || 'Contributor')})</p>
    <p class="meta">Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}</p>
    ${listing.status === 'approved' ? `<p class="notice">Notified ${subscribersCount} subscribers.</p>` : ''}
  </article>`;
}

function renderHome(query) {
  const subscribers = readJson(SUBSCRIBERS_FILE, []);
  const listings = pruneListings();
  const approved = listings.filter((l) => l.status === 'approved');

  const content = `
    <section class="hero">
      <div>
        <p class="eyebrow">Two simple paths</p>
        <h1>Either get alerts about new homes or publish them</h1>
        <p class="lede">Pick how you want to use Homes in Pats. You can subscribe for fresh listings, or submit properties as an agent or owner.</p>
      </div>
      <div class="hero-actions">
        <a class="button primary" href="#subscribe">Get notified</a>
        <a class="button ghost" href="/listings/new">Create a listing</a>
      </div>
    </section>

    <section class="split">
      <div class="panel">
        <h2>Get alerts in your inbox</h2>
        <p>Tell us where to send notifications when new homes drop. We only email when a listing is approved by the admin.</p>
        <form method="POST" action="/subscribe" id="subscribe" class="stack">
          <label>Email
            <input type="email" name="email" required placeholder="you@example.com">
          </label>
          <button class="button primary" type="submit">Subscribe</button>
        </form>
      </div>
      <div class="panel">
        <h2>List a property</h2>
        <p>Agents and owners can propose listings. They appear after admin review and are removed automatically after 5 days.</p>
        <a class="button" href="/listings/new">Start a listing</a>
      </div>
    </section>

    <section class="listings">
      <div class="section-header">
        <h2>Active listings</h2>
        <p>${approved.length} live &mdash; ${subscribers.length} subscribers</p>
      </div>
      ${approved.length ? approved.map((l) => listingCard(l, subscribers.length)).join('') : '<p class="muted">No active listings yet. Submit one to get started!</p>'}
    </section>
  `;

  return layout({ title: 'Homes in Pats', content, message: query.get('message') });
}

function renderNewListing(query) {
  const content = `
    <section class="form-card">
      <h1>Submit a listing</h1>
      <p>Share the essentials. We will review and email subscribers once approved.</p>
      <form method="POST" action="/listings" class="stack">
        <label>Contact name
          <input type="text" name="contactName" required>
        </label>
        <label>Contact email
          <input type="email" name="contactEmail" required>
        </label>
        <label>Role
          <select name="role">
            <option>Agent</option>
            <option>Owner</option>
            <option>Other</option>
          </select>
        </label>
        <label>Listing title
          <input type="text" name="title" required>
        </label>
        <label>Location
          <input type="text" name="location" required>
        </label>
        <label>Price
          <input type="text" name="price" placeholder="$450,000 or $2,200/mo">
        </label>
        <label>Description
          <textarea name="description" rows="5" required></textarea>
        </label>
        <button class="button primary" type="submit">Submit for review</button>
      </form>
    </section>
  `;

  return layout({ title: 'Create listing', content, message: query.get('message') });
}

function renderThanks() {
  const content = `
    <section class="form-card">
      <h1>Thanks for submitting</h1>
      <p>Your listing is now pending admin review. Once approved we will email subscribers.</p>
      <div class="actions">
        <a class="button" href="/">Back to home</a>
        <a class="button ghost" href="/listings/new">Submit another</a>
      </div>
    </section>
  `;
  return layout({ title: 'Submitted', content });
}

function renderAdmin(query) {
  const providedKey = query.get('key') || '';
  if (providedKey !== ADMIN_KEY) {
    const content = `
      <section class="form-card">
        <h1>Admin login</h1>
        <p>Enter the admin key to review and approve listings.</p>
        <form method="GET" action="/admin" class="stack">
          <label>Admin key
            <input type="password" name="key" required>
          </label>
          <button class="button primary" type="submit">Enter</button>
        </form>
      </section>
    `;
    return layout({ title: 'Admin', content, message: query.get('message') });
  }

  const subscribers = readJson(SUBSCRIBERS_FILE, []);
  const listings = pruneListings();
  const pending = listings.filter((l) => l.status === 'pending');
  const approved = listings.filter((l) => l.status === 'approved');

  const content = `
    <section class="admin">
      <div class="section-header">
        <h1>Admin dashboard</h1>
        <p>${subscribers.length} subscribers • ${approved.length} live listings • ${pending.length} pending</p>
      </div>
      <h2>Pending approvals</h2>
      ${pending.length ? pending.map((l) => `
        <article class="card">
          <div class="card-header">
            <h3>${escapeHtml(l.title)}</h3>
            <span class="status pending">Pending</span>
          </div>
          <p class="meta">${escapeHtml(l.location)} • ${escapeHtml(l.price || 'Price on request')}</p>
          <p>${escapeHtml(l.description)}</p>
          <p class="meta">Submitted by ${escapeHtml(l.contactName)} (${escapeHtml(l.contactEmail)})</p>
          <form method="POST" action="/admin/approve" class="inline-form">
            <input type="hidden" name="id" value="${l.id}">
            <input type="hidden" name="key" value="${providedKey}">
            <button class="button primary" type="submit">Approve & notify</button>
          </form>
        </article>
      `).join('') : '<p class="muted">Nothing pending right now.</p>'}

      <h2>Live listings</h2>
      ${approved.length ? approved.map((l) => listingCard(l, subscribers.length)).join('') : '<p class="muted">No active listings.</p>'}
    </section>
  `;

  return layout({ title: 'Admin', content, message: query.get('message') });
}

function sendNotification(listing) {
  const subscribers = readJson(SUBSCRIBERS_FILE, []);
  const logEntry = {
    at: new Date().toISOString(),
    listing: listing.title,
    recipients: subscribers,
  };
  const logPath = path.join(DATA_DIR, 'notifications.log');
  const prior = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const updated = prior + `${JSON.stringify(logEntry)}\n`;
  fs.writeFileSync(logPath, updated);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname.startsWith('/public/')) {
    return sendStatic(res, pathname.replace('/public/', ''));
  }

  if (req.method === 'GET' && pathname === '/style.css') {
    return sendStatic(res, 'style.css');
  }

  if (req.method === 'GET' && pathname === '/') {
    const page = renderHome(url.searchParams);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(page);
  }

  if (req.method === 'POST' && pathname === '/subscribe') {
    return parseBody(req).then((body) => {
      if (!body.email) {
        res.writeHead(400);
        return res.end('Email required');
      }
      addSubscriber(body.email.toLowerCase());
      return redirect(res, '/?message=' + encodeURIComponent('Subscribed! You will get approved listings by email.'));
    }).catch(() => {
      res.writeHead(400);
      res.end('Invalid request');
    });
  }

  if (req.method === 'GET' && pathname === '/listings/new') {
    const page = renderNewListing(url.searchParams);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(page);
  }

  if (req.method === 'POST' && pathname === '/listings') {
    return parseBody(req).then((body) => {
      const listing = {
        id: `lst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        contactName: body.contactName || 'Unknown',
        contactEmail: body.contactEmail || 'unknown',
        role: body.role || 'Contributor',
        title: body.title || 'Untitled listing',
        location: body.location || 'Unknown',
        price: body.price || '',
        description: body.description || '',
        createdAt: Date.now(),
        status: 'pending',
      };
      addListing(listing);
      const page = renderThanks();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page);
    }).catch(() => {
      res.writeHead(400);
      res.end('Invalid request');
    });
  }

  if (pathname === '/admin' && req.method === 'GET') {
    const page = renderAdmin(url.searchParams);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(page);
  }

  if (pathname === '/admin/approve' && req.method === 'POST') {
    return parseBody(req).then((body) => {
      if (body.key !== ADMIN_KEY) {
        res.writeHead(403);
        return res.end('Invalid admin key');
      }
      const listing = updateListing(body.id, (l) => ({ ...l, status: 'approved' }));
      if (listing) {
        sendNotification(listing);
        return redirect(res, `/admin?key=${encodeURIComponent(body.key)}&message=${encodeURIComponent('Listing approved and notifications logged')}`);
      }
      res.writeHead(404);
      return res.end('Listing not found');
    }).catch(() => {
      res.writeHead(400);
      res.end('Invalid request');
    });
  }

  return notFound(res);
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(LISTINGS_FILE)) {
  writeJson(LISTINGS_FILE, []);
}
if (!fs.existsSync(SUBSCRIBERS_FILE)) {
  writeJson(SUBSCRIBERS_FILE, []);
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Homes in Pats server running on http://localhost:${PORT}`);
});
