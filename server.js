const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs').promises;

// Set timezone to Australia/Sydney
process.env.TZ = 'Australia/Sydney';

const app = express();
const PORT = process.env.PORT || 8003;
const BASE_URL = process.env.BASE_URL || 'http://localhost:8003';

// Persistent storage using JSON files
const DATA_DIR = path.join(__dirname, 'data');
const PARTIES_FILE = path.join(DATA_DIR, 'parties.json');
const ASSIGNMENTS_FILE = path.join(DATA_DIR, 'assignments.json');
const GUEST_LINKS_FILE = path.join(DATA_DIR, 'guest_links.json');

// In-memory storage
const parties = new Map();
const assignments = new Map();
const guestLinks = new Map(); // guestId -> {partyId, guestName}

// Load data from files on startup
async function loadData() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    const [partiesData, assignmentsData, guestLinksData] = await Promise.all([
      fs.readFile(PARTIES_FILE, 'utf8').catch(() => '{}'),
      fs.readFile(ASSIGNMENTS_FILE, 'utf8').catch(() => '{}'),
      fs.readFile(GUEST_LINKS_FILE, 'utf8').catch(() => '{}')
    ]);
    
    // Safe JSON parsing with fallback
    let partiesObj = {};
    let assignmentsObj = {};
    let guestLinksObj = {};
    
    try {
      partiesObj = JSON.parse(partiesData);
    } catch (e) {
      console.error('ملف parties.json تالف، سيتم البدء من جديد');
    }
    
    try {
      assignmentsObj = JSON.parse(assignmentsData);
    } catch (e) {
      console.error('ملف assignments.json تالف، سيتم البدء من جديد');
    }
    
    try {
      guestLinksObj = JSON.parse(guestLinksData);
    } catch (e) {
      console.error('ملف guest_links.json تالف، سيتم البدء من جديد');
    }
    
    Object.entries(partiesObj).forEach(([key, value]) => parties.set(key, value));
    Object.entries(assignmentsObj).forEach(([key, value]) => assignments.set(key, value));
    Object.entries(guestLinksObj).forEach(([key, value]) => guestLinks.set(key, value));
    
    console.log('تم تحميل البيانات بنجاح');
  } catch (error) {
    console.error('حدث خطأ أثناء تحميل البيانات:', error);
  }
}

// Save data to files with atomic writes and backup
let saveInProgress = false;
async function saveData() {
  if (saveInProgress) {
    console.log('حفظ البيانات جاري بالفعل، يتم التجاوز');
    return;
  }
  
  saveInProgress = true;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(DATA_DIR, 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    for (const [file, filename] of [
      [PARTIES_FILE, 'parties.json'],
      [ASSIGNMENTS_FILE, 'assignments.json'],
      [GUEST_LINKS_FILE, 'guest_links.json']
    ]) {
      try {
        const data = await fs.readFile(file, 'utf8');
        await fs.writeFile(path.join(backupDir, `${filename}.${timestamp}.backup`), data);
      } catch (e) {
        // File doesn't exist, skip backup
      }
    }
    
    const partiesData = JSON.stringify(Object.fromEntries(parties), null, 2);
    const assignmentsData = JSON.stringify(Object.fromEntries(assignments), null, 2);
    const guestLinksData = JSON.stringify(Object.fromEntries(guestLinks), null, 2);
    
    await Promise.all([
      fs.writeFile(PARTIES_FILE, partiesData),
      fs.writeFile(ASSIGNMENTS_FILE, assignmentsData),
      fs.writeFile(GUEST_LINKS_FILE, guestLinksData)
    ]);
    
    console.log('تم حفظ البيانات بنجاح');
  } catch (error) {
    console.error('حدث خطأ أثناء حفظ البيانات:', error);
  } finally {
    saveInProgress = false;
  }
}

// Validation helpers
function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength).replace(/[<>"'&]/g, '');
}

function validateGuestName(name) {
  const sanitized = sanitizeString(name, 50);
  if (!sanitized || sanitized.length < 1) {
    throw new Error('اسم الضيف لا يمكن أن يكون فارغاً');
  }
  return sanitized;
}

function validatePartyName(name) {
  const sanitized = sanitizeString(name, 100);
  if (!sanitized || sanitized.length < 1) {
    throw new Error('اسم الحفلة لا يمكن أن يكون فارغاً');
  }
  return sanitized;
}

// Rate limiting (simple in-memory)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

function isRateLimited(clientId) {
  const now = Date.now();
  const requests = rateLimitMap.get(clientId) || [];
  const recentRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  recentRequests.push(now);
  rateLimitMap.set(clientId, recentRequests);
  return false;
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create a new party
app.post('/api/parties', async (req, res) => {
  try {
    const clientId = req.ip || req.connection.remoteAddress;
    if (isRateLimited(clientId)) {
      return res.status(429).json({ error: 'عدد كبير جداً من الطلبات. يرجى الانتظار دقيقة.' });
    }

    const { name, budget, criteria, guests } = req.body;
    
    if (!name || !guests || !Array.isArray(guests) || guests.length < 2) {
      return res.status(400).json({ error: 'اسم الحفلة ووجود ضيفين على الأقل مطلوب' });
    }

    if (guests.length > 50) {
      return res.status(400).json({ error: 'الحد الأقصى للضيوف هو 50' });
    }

    const sanitizedName = validatePartyName(name);
    const sanitizedBudget = sanitizeString(budget || '', 50);
    const sanitizedCriteria = sanitizeString(criteria || '', 500);
    
    const sanitizedGuests = guests.map(g => {
      try {
        return validateGuestName(g);
      } catch (e) {
        throw new Error(`اسم الضيف غير صالح: ${g}`);
      }
    });
    
    const uniqueGuests = [...new Set(sanitizedGuests)];
    if (uniqueGuests.length !== sanitizedGuests.length) {
      return res.status(400).json({ error: 'يجب أن تكون أسماء الضيوف فريدة' });
    }

    const partyId = uuidv4();
    const party = {
      id: partyId,
      name: sanitizedName,
      budget: sanitizedBudget,
      criteria: sanitizedCriteria,
      guests: sanitizedGuests,
      createdAt: new Date().toLocaleString('en-AU', { 
        timeZone: 'Australia/Sydney',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }) + ' AEDT'
    };

    parties.set(partyId, party);
    
    const guestUrls = {};
    party.guests.forEach(guest => {
      const guestId = uuidv4();
      guestLinks.set(guestId, {
        partyId: partyId,
        guestName: guest
      });
      guestUrls[guest] = `${BASE_URL}/guest/${guestId}`;
    });
    
    await saveData();
    
    res.json({ 
      partyId, 
      guestUrls,
      party 
    });
  } catch (error) {
    console.error('حدث خطأ أثناء إنشاء الحفلة:', error);
    res.status(400).json({ error: error.message || 'بيانات الطلب غير صالحة' });
  }
});

// Get party details (for reference only)
app.get('/api/parties/:id', (req, res) => {
  const party = parties.get(req.params.id);
  if (!party) {
    return res.status(404).json({ error: 'الحفلة غير موجودة' });
  }
  res.json(party);
});

// Assign Secret Santa
app.post('/api/parties/:id/assign', async (req, res) => {
  try {
    const clientId = req.ip || req.connection.remoteAddress;
    if (isRateLimited(clientId)) {
      return res.status(429).json({ error: 'عدد كبير جداً من الطلبات. يرجى الانتظار دقيقة.' });
    }

    const { guestName } = req.body;
    const partyId = req.params.id;
    
    if (!guestName || typeof guestName !== 'string') {
      return res.status(400).json({ error: 'اسم الضيف مطلوب' });
    }

    const sanitizedGuestName = sanitizeString(guestName, 50);
    if (!sanitizedGuestName) {
      return res.status(400).json({ error: 'اسم الضيف غير صالح' });
    }

    const party = parties.get(partyId);
    
    if (!party) {
      return res.status(404).json({ error: 'الحفلة غير موجودة' });
    }

    if (!party.guests.includes(sanitizedGuestName)) {
      return res.status(400).json({ error: 'الضيف غير موجود في الحفلة' });
    }

    const existingAssignment = assignments.get(`${partyId}-${sanitizedGuestName}`);
    if (existingAssignment) {
      return res.json({ assignment: existingAssignment });
    }

    if (!assignments.has(partyId)) {
      const shuffled = [...party.guests];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      
      for (let i = 0; i < shuffled.length; i++) {
        if (shuffled[i] === party.guests[i]) {
          if (i === shuffled.length - 1) {
            [shuffled[i], shuffled[i - 1]] = [shuffled[i - 1], shuffled[i]];
          } else {
            [shuffled[i], shuffled[i + 1]] = [shuffled[i + 1], shuffled[i]];
          }
        }
      }

      const partyAssignments = {};
      party.guests.forEach((guest, index) => {
        partyAssignments[guest] = shuffled[index];
      });
      
      assignments.set(partyId, partyAssignments);
    }

    const partyAssignments = assignments.get(partyId);
    const assignment = partyAssignments[sanitizedGuestName];
    
    await saveData();
    
    res.json({ assignment });
  } catch (error) {
    console.error('حدث خطأ أثناء التعيين:', error);
    res.status(500).json({ error: 'حدث خطأ في الخادم' });
  }
});

// Get guest assignment by guest ID
app.get('/api/guest/:id/assignment', async (req, res) => {
  try {
    const clientId = req.ip || req.connection.remoteAddress;
    if (isRateLimited(clientId)) {
      return res.status(429).json({ error: 'عدد كبير جداً من الطلبات. يرجى الانتظار دقيقة.' });
    }

    const guestId = req.params.id;
    
    if (!guestId || typeof guestId !== 'string' || guestId.length !== 36) {
      return res.status(400).json({ error: 'معرف الضيف غير صالح' });
    }

    const guestLink = guestLinks.get(guestId);
    
    if (!guestLink) {
      return res.status(404).json({ error: 'رابط الضيف غير موجود' });
    }
    
    const party = parties.get(guestLink.partyId);
    if (!party) {
      return res.status(404).json({ error: 'الحفلة غير موجودة' });
    }
    
    if (!assignments.has(guestLink.partyId)) {
      const shuffled = [...party.guests];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      
      for (let i = 0; i < shuffled.length; i++) {
        if (shuffled[i] === party.guests[i]) {
          if (i === shuffled.length - 1) {
            [shuffled[i], shuffled[i - 1]] = [shuffled[i - 1], shuffled[i]];
          } else {
            [shuffled[i], shuffled[i + 1]] = [shuffled[i + 1], shuffled[i]];
          }
        }
      }

      const partyAssignments = {};
      party.guests.forEach((guest, index) => {
        partyAssignments[guest] = shuffled[index];
      });
      
      assignments.set(guestLink.partyId, partyAssignments);
      await saveData();
    }

    const partyAssignments = assignments.get(guestLink.partyId);
    const assignment = partyAssignments[guestLink.guestName];
    
    res.json({ 
      party: {
        name: party.name,
        budget: party.budget,
        criteria: party.criteria
      },
      guestName: guestLink.guestName,
      assignment 
    });
  } catch (error) {
    console.error('حدث خطأ أثناء جلب التعيين:', error);
    res.status(500).json({ error: 'حدث خطأ في الخادم' });
  }
});

// Serve guest page
app.get('/guest/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guest.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`تطبيق سِكريت سانتا يعمل على http://0.0.0.0:${PORT}`);
  await loadData();
});
