// src/dashboard-enhanced.ts - Enhanced Dashboard with Modern UI
import { CryptoAsset } from './parser/types';

export function getEnhancedDashboard(assets: CryptoAsset[]): string {
  const total = assets.length;
  const high = assets.filter(a => a.severity === 'high').length;
  const medium = assets.filter(a => a.severity === 'medium').length;
  const low = assets.filter(a => a.severity === 'low').length;
  const pqc = assets.filter(a => a.quantumSafe === true).length;
  const vulnerable = assets.filter(a => a.quantumSafe === false).length;
  const partial = assets.filter(a => a.quantumSafe === 'partial').length;

  // Group by type
  const byType: Record<string, CryptoAsset[]> = {};
  assets.forEach(a => {
    const type = (a.primitive || a.type || 'unknown').toLowerCase();
    if (!byType[type]) byType[type] = [];
    byType[type].push(a);
  });

  const assetsJson = JSON.stringify(assets);
  const byTypeJson = JSON.stringify(byType);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crypto Detector - Security Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --bg-primary: #0a0e27;
      --bg-secondary: #151b35;
      --bg-card: #1a1f3a;
      --text-primary: #e6e8f0;
      --text-secondary: #a0a8c0;
      --accent-primary: #667eea;
      --accent-secondary: #764ba2;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --border: rgba(255, 255, 255, 0.1);
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, var(--bg-primary) 0%, #1a1f3a 100%);
      color: var(--text-primary);
      min-height: 100vh;
      padding: 0;
      overflow-x: hidden;
    }

    .header {
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
      padding: 2rem 3rem;
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
      position: relative;
      overflow: hidden;
    }

    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.05) 100%);
      pointer-events: none;
    }

    .header-content {
      position: relative;
      z-index: 1;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header h1 {
      font-size: 2rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .logo {
      width: 48px;
      height: 48px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }

    .header-actions {
      display: flex;
      gap: 1rem;
    }

    .btn {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .btn:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: linear-gradient(180deg, var(--accent-primary), var(--accent-secondary));
    }

    .stat-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
      border-color: var(--accent-primary);
    }

    .stat-label {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
      font-weight: 600;
    }

    .stat-value {
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
    }

    .stat-card.danger .stat-value { color: var(--danger); }
    .stat-card.warning .stat-value { color: var(--warning); }
    .stat-card.success .stat-value { color: var(--success); }
    .stat-card.primary .stat-value { color: var(--accent-primary); }

    .stat-icon {
      position: absolute;
      right: 1rem;
      top: 1rem;
      font-size: 2rem;
      opacity: 0.2;
    }

    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
      gap: 2rem;
      margin-bottom: 2rem;
    }

    .chart-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.3s ease;
    }

    .chart-card:hover {
      border-color: var(--accent-primary);
      box-shadow: 0 4px 16px rgba(102, 126, 234, 0.15);
    }

    .chart-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .chart-container {
      position: relative;
      height: 300px;
    }

    .table-section {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      overflow: hidden;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .section-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .filter-group {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .filter-btn {
      background: rgba(102, 126, 234, 0.1);
      border: 1px solid rgba(102, 126, 234, 0.3);
      color: var(--text-secondary);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.3s ease;
      font-weight: 500;
    }

    .filter-btn:hover,
    .filter-btn.active {
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
      border-color: transparent;
      color: white;
      transform: scale(1.05);
    }

    .table-container {
      overflow-x: auto;
      margin-top: 1rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      background: rgba(102, 126, 234, 0.1);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    th {
      padding: 1rem;
      text-align: left;
      font-weight: 600;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--accent-primary);
      border-bottom: 2px solid var(--accent-primary);
    }

    td {
      padding: 1rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    tr:hover td {
      background: rgba(102, 126, 234, 0.05);
      color: var(--text-primary);
    }

    .badge {
      display: inline-block;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .badge.high {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .badge.medium {
      background: rgba(245, 158, 11, 0.2);
      color: #fcd34d;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge.low {
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .badge.safe {
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .badge.vulnerable {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .badge.partial {
      background: rgba(245, 158, 11, 0.2);
      color: #fcd34d;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .empty-state {
      text-align: center;
      padding: 3rem;
      color: var(--text-secondary);
    }

    .empty-state-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      opacity: 0.3;
    }

    @media (max-width: 768px) {
      .charts-grid {
        grid-template-columns: 1fr;
      }
      
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .stat-card,
    .chart-card,
    .table-section {
      animation: fadeIn 0.6s ease-out;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-content">
      <h1>
        <div class="logo">🔐</div>
        Crypto Detector Security Dashboard
      </h1>
      <div class="header-actions">
        <button class="btn" id="exportBtn">
          📦 Export CBOM
        </button>
        <button class="btn" id="refreshBtn">
          🔄 Refresh
        </button>
      </div>
    </div>
  </div>

  <div class="container">
    <!-- Statistics Cards -->
    <div class="stats-grid">
      <div class="stat-card primary">
        <div class="stat-icon">📊</div>
        <div class="stat-label">Total Assets</div>
        <div class="stat-value">${total}</div>
      </div>
      
      <div class="stat-card danger">
        <div class="stat-icon">🔴</div>
        <div class="stat-label">High Risk</div>
        <div class="stat-value">${high}</div>
      </div>
      
      <div class="stat-card warning">
        <div class="stat-icon">🟡</div>
        <div class="stat-label">Medium Risk</div>
        <div class="stat-value">${medium}</div>
      </div>
      
      <div class="stat-card success">
        <div class="stat-icon">🟢</div>
        <div class="stat-label">Low Risk</div>
        <div class="stat-value">${low}</div>
      </div>
      
      <div class="stat-card success">
        <div class="stat-icon">✅</div>
        <div class="stat-label">Quantum-Safe</div>
        <div class="stat-value">${pqc}</div>
      </div>
      
      <div class="stat-card danger">
        <div class="stat-icon">❌</div>
        <div class="stat-label">Vulnerable</div>
        <div class="stat-value">${vulnerable}</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title">📊 Risk Distribution</div>
        <div class="chart-container">
          <canvas id="riskChart"></canvas>
        </div>
      </div>
      
      <div class="chart-card">
        <div class="chart-title">🛡️ Quantum Readiness</div>
        <div class="chart-container">
          <canvas id="quantumChart"></canvas>
        </div>
      </div>
      
      <div class="chart-card">
        <div class="chart-title">🔑 Algorithm Types</div>
        <div class="chart-container">
          <canvas id="typeChart"></canvas>
        </div>
      </div>
      
      <div class="chart-card">
        <div class="chart-title">⚠️ Top Risk Algorithms</div>
        <div class="chart-container">
          <canvas id="topRiskChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Data Table -->
    <div class="table-section">
      <div class="section-header">
        <div class="section-title">🔍 Detected Algorithms</div>
        <div class="filter-group">
          <button class="filter-btn active" data-filter="all">All (${total})</button>
          <button class="filter-btn" data-filter="high">High (${high})</button>
          <button class="filter-btn" data-filter="medium">Medium (${medium})</button>
          <button class="filter-btn" data-filter="low">Low (${low})</button>
          <button class="filter-btn" data-filter="vulnerable">Vulnerable (${vulnerable})</button>
        </div>
      </div>
      
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Algorithm</th>
              <th>Type</th>
              <th>Occurrences</th>
              <th>Quantum Status</th>
              <th>Severity</th>
              <th>Risk Score</th>
            </tr>
          </thead>
          <tbody id="assetTable"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const allAssets = ${assetsJson};
    const byType = ${byTypeJson};

    // Render table
    function renderTable(filter = 'all') {
      const tbody = document.getElementById('assetTable');
      let filtered = allAssets;

      if (filter === 'high') filtered = allAssets.filter(a => a.severity === 'high');
      else if (filter === 'medium') filtered = allAssets.filter(a => a.severity === 'medium');
      else if (filter === 'low') filtered = allAssets.filter(a => a.severity === 'low');
      else if (filter === 'vulnerable') filtered = allAssets.filter(a => a.quantumSafe === false);

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-state-icon">🎉</div><div>No algorithms match this filter</div></td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map(asset => {
        const qStatus = asset.quantumSafe === true ? 'safe' : 
                       asset.quantumSafe === false ? 'vulnerable' : 'partial';
        const qLabel = asset.quantumSafe === true ? '✅ Safe' :
                      asset.quantumSafe === false ? '❌ Vulnerable' : '⚠️ Partial';
        
        return \`<tr>
          <td><strong>\${asset.name || 'Unknown'}</strong></td>
          <td>\${asset.primitive || asset.type || 'unknown'}</td>
          <td>\${asset.occurrences || 1}</td>
          <td><span class="badge \${qStatus}">\${qLabel}</span></td>
          <td><span class="badge \${asset.severity || 'low'}">\${(asset.severity || 'low').toUpperCase()}</span></td>
          <td>\${asset.riskScore || asset.score || 0}</td>
        </tr>\`;
      }).join('');
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
    const chartConfig = {
      plugins: {
        legend: {
          labels: { color: '#e6e8f0', font: { size: 12 } }
        }
      },
      maintainAspectRatio: false
    };

    new Chart(document.getElementById('riskChart'), {
      type: 'doughnut',
      data: {
        labels: ['High', 'Medium', 'Low'],
        datasets: [{
          data: [${high}, ${medium}, ${low}],
          backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
          borderWidth: 0
        }]
      },
      options: chartConfig
    });

    new Chart(document.getElementById('quantumChart'), {
      type: 'bar',
      data: {
        labels: ['Safe', 'Partial', 'Vulnerable'],
        datasets: [{
          data: [${pqc}, ${partial}, ${vulnerable}],
          backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
          borderWidth: 0,
          borderRadius: 8
        }]
      },
      options: {
        ...chartConfig,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: '#a0a8c0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          x: { ticks: { color: '#a0a8c0' }, grid: { display: false } }
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
          backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a'],
          borderWidth: 0
        }]
      },
      options: chartConfig
    });

    const topRisk = [...allAssets].sort((a,b) => (b.riskScore||0) - (a.riskScore||0)).slice(0, 8);
    new Chart(document.getElementById('topRiskChart'), {
      type: 'bar',
      data: {
        labels: topRisk.map(a => a.name),
        datasets: [{
          data: topRisk.map(a => a.riskScore || a.score || 0),
          backgroundColor: '#ef4444',
          borderRadius: 8,
          borderWidth: 0
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#a0a8c0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#a0a8c0' }, grid: { display: false } }
        },
        maintainAspectRatio: false
      }
    });

    // Button handlers
    document.getElementById('exportBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'generateCbom' });
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      location.reload();
    });
  </script>
</body>
</html>`;
}