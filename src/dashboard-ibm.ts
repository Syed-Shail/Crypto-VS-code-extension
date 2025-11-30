// src/dashboard-ibm.ts
import { CryptoAsset } from './parser/types';

/**
 * IBM CBOMKit-style professional dashboard
 */
export function getIBMStyleDashboard(assets: CryptoAsset[]): string {
  const total = assets.length;
  const high = assets.filter(a => a.severity === 'high').length;
  const medium = assets.filter(a => a.severity === 'medium').length;
  const low = assets.filter(a => a.severity === 'low').length;
  const pqc = assets.filter(a => a.quantumSafe === true).length;
  const vulnerable = assets.filter(a => a.quantumSafe === false).length;
  const partial = assets.filter(a => a.quantumSafe === 'partial').length;

  // Group by algorithm type
  const byType: Record<string, CryptoAsset[]> = {};
  assets.forEach(a => {
    const type = (a.primitive || 'unknown').toLowerCase();
    if (!byType[type]) byType[type] = [];
    byType[type].push(a);
  });

  // Serialize data for client
  const assetsJson = JSON.stringify(assets);
  const byTypeJson = JSON.stringify(byType);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cryptographic Bill of Materials (CBOM)</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f62fe 0%, #001d6c 100%);
      color: #f4f4f4;
      padding: 0;
      min-height: 100vh;
    }

    .header {
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(10px);
      padding: 20px 40px;
      border-bottom: 2px solid rgba(15, 98, 254, 0.5);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header h1 {
      font-size: 28px;
      font-weight: 600;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .ibm-logo {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(135deg, #0f62fe, #00a3e0);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -1px;
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }

    .btn {
      background: linear-gradient(135deg, #0f62fe, #0353e9);
      border: none;
      color: white;
      padding: 10px 24px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(15, 98, 254, 0.3);
    }

    .btn:hover {
      background: linear-gradient(135deg, #0353e9, #002d9c);
      box-shadow: 0 4px 12px rgba(15, 98, 254, 0.5);
      transform: translateY(-1px);
    }

    .btn.secondary {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .btn.secondary:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .container {
      max-width: 1600px;
      margin: 0 auto;
      padding: 40px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .summary-card {
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }

    .summary-card h3 {
      font-size: 14px;
      font-weight: 400;
      color: #c6c6c6;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .summary-card .value {
      font-size: 48px;
      font-weight: 600;
      color: #ffffff;
      line-height: 1;
    }

    .summary-card.high .value { color: #ff6b6b; }
    .summary-card.medium .value { color: #ffa500; }
    .summary-card.low .value { color: #4caf50; }
    .summary-card.quantum .value { color: #00d4ff; }

    .chart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
      gap: 24px;
      margin-bottom: 40px;
    }

    .chart-card {
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }

    .chart-card h2 {
      font-size: 18px;
      font-weight: 500;
      color: #ffffff;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid rgba(15, 98, 254, 0.3);
    }

    canvas {
      max-height: 300px !important;
    }

    .table-container {
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      overflow-x: auto;
    }

    .table-container h2 {
      font-size: 20px;
      font-weight: 500;
      color: #ffffff;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid rgba(15, 98, 254, 0.3);
    }

    .filter-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .filter-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #c6c6c6;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    }

    .filter-btn:hover, .filter-btn.active {
      background: rgba(15, 98, 254, 0.3);
      border-color: #0f62fe;
      color: #ffffff;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      background: rgba(15, 98, 254, 0.2);
      position: sticky;
      top: 0;
    }

    th {
      padding: 12px 16px;
      text-align: left;
      font-weight: 500;
      color: #ffffff;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid rgba(15, 98, 254, 0.5);
    }

    td {
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      color: #e0e0e0;
      font-size: 14px;
    }

    tr:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .severity-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .severity-high { background: #da1e28; color: white; }
    .severity-medium { background: #ff832b; color: white; }
    .severity-low { background: #24a148; color: white; }
    .severity-none { background: #0f62fe; color: white; }
    .severity-unknown { background: #8d8d8d; color: white; }

    .quantum-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }

    .quantum-safe { background: #24a148; color: white; }
    .quantum-vulnerable { background: #da1e28; color: white; }
    .quantum-partial { background: #ff832b; color: white; }
    .quantum-unknown { background: #8d8d8d; color: white; }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #c6c6c6;
    }

    .empty-state h3 {
      font-size: 24px;
      margin-bottom: 12px;
      color: #ffffff;
    }

    @media (max-width: 768px) {
      .chart-grid {
        grid-template-columns: 1fr;
      }
      .summary-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>
      <span class="ibm-logo">IBM</span>
      Cryptographic Bill of Materials (CBOM)
    </h1>
    <div class="header-actions">
      <button class="btn" id="exportCbom">📦 Export CBOM</button>
      <button class="btn secondary" id="refreshData">🔄 Refresh</button>
    </div>
  </div>

  <div class="container">
    <div class="summary-grid">
      <div class="summary-card">
        <h3>Total Assets</h3>
        <div class="value">${total}</div>
      </div>
      <div class="summary-card high">
        <h3>High Risk</h3>
        <div class="value">${high}</div>
      </div>
      <div class="summary-card medium">
        <h3>Medium Risk</h3>
        <div class="value">${medium}</div>
      </div>
      <div class="summary-card low">
        <h3>Low Risk</h3>
        <div class="value">${low}</div>
      </div>
      <div class="summary-card quantum">
        <h3>Quantum-Safe</h3>
        <div class="value">${pqc}</div>
      </div>
      <div class="summary-card high">
        <h3>Quantum-Vulnerable</h3>
        <div class="value">${vulnerable}</div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <h2>Risk Distribution</h2>
        <canvas id="riskChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>Quantum Readiness</h2>
        <canvas id="quantumChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>Algorithm Types</h2>
        <canvas id="typeChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>Top 10 Risk Algorithms</h2>
        <canvas id="topRiskChart"></canvas>
      </div>
    </div>

    <div class="table-container">
      <h2>Cryptographic Asset Inventory</h2>
      <div class="filter-bar">
        <button class="filter-btn active" data-filter="all">All (${total})</button>
        <button class="filter-btn" data-filter="high">High Risk (${high})</button>
        <button class="filter-btn" data-filter="medium">Medium Risk (${medium})</button>
        <button class="filter-btn" data-filter="low">Low Risk (${low})</button>
        <button class="filter-btn" data-filter="vulnerable">Quantum-Vulnerable (${vulnerable})</button>
        <button class="filter-btn" data-filter="safe">Quantum-Safe (${pqc})</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Algorithm</th>
            <th>Type</th>
            <th>Occurrences</th>
            <th>Quantum Status</th>
            <th>Risk Score</th>
            <th>Severity</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody id="assetTable"></tbody>
      </table>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const allAssets = ${assetsJson};
    const byType = ${byTypeJson};

    // Build table row
    function buildRow(asset) {
      const qStatus = asset.quantumSafe === true ? 'safe' : 
                      asset.quantumSafe === false ? 'vulnerable' :
                      asset.quantumSafe === 'partial' ? 'partial' : 'unknown';
      const qLabel = asset.quantumSafe === true ? '✓ Safe' :
                     asset.quantumSafe === false ? '✗ Vulnerable' :
                     asset.quantumSafe === 'partial' ? '⚠ Partial' : '? Unknown';
      
      const location = asset.detectionContexts?.[0]?.filePath || asset.source || '-';
      const filename = location.split(/[\\/]/).pop();
      
      return '<tr data-severity="' + (asset.severity || 'unknown') + '" data-quantum="' + qStatus + '">' +
        '<td><strong>' + (asset.name || 'Unknown') + '</strong></td>' +
        '<td>' + (asset.primitive || asset.type || 'unknown') + '</td>' +
        '<td>' + (asset.occurrences || 1) + '</td>' +
        '<td><span class="quantum-badge quantum-' + qStatus + '">' + qLabel + '</span></td>' +
        '<td>' + (asset.riskScore || asset.score || 0) + '</td>' +
        '<td><span class="severity-badge severity-' + (asset.severity || 'unknown') + '">' + 
          (asset.severity || 'unknown').toUpperCase() + '</span></td>' +
        '<td title="' + location + '">' + filename + '</td>' +
      '</tr>';
    }

    function renderTable(filter = 'all') {
      const tbody = document.getElementById('assetTable');
      let filtered = allAssets;

      if (filter === 'high') filtered = allAssets.filter(a => a.severity === 'high');
      else if (filter === 'medium') filtered = allAssets.filter(a => a.severity === 'medium');
      else if (filter === 'low') filtered = allAssets.filter(a => a.severity === 'low');
      else if (filter === 'vulnerable') filtered = allAssets.filter(a => a.quantumSafe === false);
      else if (filter === 'safe') filtered = allAssets.filter(a => a.quantumSafe === true);

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#8d8d8d;">No assets match this filter</td></tr>';
      } else {
        tbody.innerHTML = filtered.map(buildRow).join('');
      }
    }

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTable(btn.dataset.filter);
      });
    });

    renderTable('all');

    // Charts
    new Chart(document.getElementById('riskChart'), {
      type: 'doughnut',
      data: {
        labels: ['High Risk', 'Medium Risk', 'Low Risk'],
        datasets: [{
          data: [${high}, ${medium}, ${low}],
          backgroundColor: ['#da1e28', '#ff832b', '#24a148']
        }]
      },
      options: { plugins: { legend: { labels: { color: '#f4f4f4' } } } }
    });

    new Chart(document.getElementById('quantumChart'), {
      type: 'bar',
      data: {
        labels: ['Quantum-Safe', 'Partial', 'Vulnerable'],
        datasets: [{
          data: [${pqc}, ${partial}, ${vulnerable}],
          backgroundColor: ['#24a148', '#ff832b', '#da1e28']
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#f4f4f4' }, grid: { color: 'rgba(255,255,255,0.1)' } },
          y: { ticks: { color: '#f4f4f4' }, grid: { display: false } }
        }
      }
    });

    const typeLabels = Object.keys(byType);
    const typeCounts = typeLabels.map(k => byType[k].length);
    new Chart(document.getElementById('typeChart'), {
      type: 'pie',
      data: {
        labels: typeLabels,
        datasets: [{
          data: typeCounts,
          backgroundColor: ['#0f62fe', '#00d4ff', '#8a3ffc', '#ff832b', '#24a148', '#da1e28']
        }]
      },
      options: { plugins: { legend: { labels: { color: '#f4f4f4' } } } }
    });

    const topRisk = [...allAssets].sort((a,b) => (b.riskScore||0) - (a.riskScore||0)).slice(0, 10);
    new Chart(document.getElementById('topRiskChart'), {
      type: 'bar',
      data: {
        labels: topRisk.map(a => a.name),
        datasets: [{
          label: 'Risk Score',
          data: topRisk.map(a => a.riskScore || a.score || 0),
          backgroundColor: '#da1e28'
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#f4f4f4' }, grid: { color: 'rgba(255,255,255,0.1)' } },
          y: { ticks: { color: '#f4f4f4' }, grid: { display: false } }
        }
      }
    });

    // Export button
    document.getElementById('exportCbom').addEventListener('click', () => {
      vscode.postMessage({ command: 'generateCbom' });
    });

    document.getElementById('refreshData').addEventListener('click', () => {
      location.reload();
    });
  </script>
</body>
</html>`;
}