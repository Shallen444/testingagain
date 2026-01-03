const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs').promises;

process.env.TZ = 'Australia/Sydney';

const app = express();
const PORT = process.env.PORT || 8003;
const BASE_URL = process.env.BASE_URL || 'http://localhost:8003';

const DATA_DIR = path.join(__dirname, 'data');
const PARTIES_FILE = path.join(DATA_DIR, 'parties.json');
const ASSIGNMENTS_FILE = path.join(DATA_DIR, 'assignments.json');
const GUEST_LINKS_FILE = path.join(DATA_DIR, 'guest_links.json');

const parties = new Map();
const assignments = new Map();
const guestLinks = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/guest/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guest.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
