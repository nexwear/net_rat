const express = require('express');
const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend' });
});

app.listen(4000, () => {
  console.log('Backend running on port 4000');
});
