// src/dashboard.ts
import { CryptoAsset } from './parser/types';
import { getQuantumAlternativeSuggestion } from './parser/quantum-alternatives';

/**
 * Builds the HTML dashboard view with multiple charts and a summary table.
 */
export function getDashboardHtml(assets: CryptoAsset[]): string {
  const total = assets.length;
  const high = assets.filter(a => a.severity === 'high').length;
  const medium = assets.filter(a => a.severity === 'medium').length;
  const low = assets.filter(a => a.severity === 'low').length;
  const pqc = assets.filter(a => a.quantumSafe === true).length;
  const partial = assets.filter(a => a.quantumSafe === 'partial').length;
  const classical = assets.filter(a => a.quantumSafe === false).length;

  // Group algorithm types
  const typeCounts: Record<string, number> = {};
  assets.forEach(a => {
    const t = (a.primitive || 'unknown').toLowerCase();
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  // Top 5 by risk
  const topRisk = [...assets].sort((a, b) => (b.riskScore ?? b.score ?? 0) - (a.riskScore ?? a.score ?? 0)).slice(0, 5);

  // Pre-build rows for the initial table (server-side)
  const initialRows = assets.map(a => {
    const suggestion = getQuantumAlternativeSuggestion(a);
    return '<tr>' +
      '<td>' + (a.name ?? 'Unknown') + '</td>' +
      '<td>' + (a.primitive ?? 'Unknown') + '</td>' +
      '<td>' + (String(a.quantumSafe ?? 'Unknown')) + '</td>' +
      '<td>' + (a.riskScore ?? '-') + '</td>' +
      '<td>' + ((a.severity ?? '-').toUpperCase()) + '</td>' +
      '<td>' + suggestion.alternative + '</td>' +
      '<td>' + suggestion.basis + '</td>' +
    '</tr>'
  }).join('');

  // Serialize some data to be used by client-side script
  const assetsJson = JSON.stringify(assets);
  const typeCountsJson = JSON.stringify(typeCounts);
  const topRiskJson = JSON.stringify(topRisk);

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Crypto Risk Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
      body {
        font-family: system-ui, sans-serif;
        background-color: #0d1117;
        color: #e6edf3;
        padding: 20px;
      }
      h2 {
        color: #58a6ff;
      }
      .charts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 24px;
        margin-bottom: 40px;
      }
      canvas {
        background: #161b22;
        border-radius: 10px;
        padding: 10px;
        width: 100% !important;
        height: 260px !important;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 30px;
        background-color: #161b22;
        border-radius: 10px;
        overflow: hidden;
      }
      th, td {
        padding: 10px;
        border-bottom: 1px solid #30363d;
      }
      th {
        background-color: #21262d;
        color: #58a6ff;
      }
      tr:hover {
        background-color: #1f2937;
      }
      .controls {
        margin-bottom: 16px;
      }
      button {
        background-color: #238636;
        border: none;
        color: white;
        padding: 10px 18px;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
      }
      button.secondary {
        background-color: #444;
        margin-left: 8px;
      }
      button:hover {
        filter: brightness(1.05);
      }
    </style>
  </head>
  <body>
    <h2>🔐 Crypto Risk Dashboard</h2>
    <div class="controls">
      <button id="generateCbom">📦 Generate CBOM</button>
      <button id="resetFilter" class="secondary">🔁 Show All</button>
    </div>

    <div class="charts">
      <div>
        <h3>Risk Severity Distribution</h3>
        <canvas id="riskChart"></canvas>
      </div>
      <div>
        <h3>Quantum Safety Overview</h3>
        <canvas id="pqcChart"></canvas>
      </div>
      <div>
        <h3>Algorithm Type Breakdown</h3>
        <canvas id="typeChart"></canvas>
      </div>
      <div>
        <h3>Top 5 Risk Algorithms</h3>
        <canvas id="topRiskChart"></canvas>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Algorithm</th>
          <th>Type</th>
          <th>Quantum Safe</th>
          <th>Risk Score</th>
          <th>Severity</th>
          <th>Suggested Alternative</th>
          <th>Basis</th>
        </tr>
      </thead>
      <tbody id="resultsTableBody">
        ${initialRows}
      </tbody>
    </table>

    <script>
      // Data passed from extension
      const allResults = ${assetsJson};
      const typeCounts = ${typeCountsJson};
      const topRisk = ${topRiskJson};

      function getSuggestion(a) {
        const name = (a.name || '').trim().toLowerCase();
        const primitive = (a.primitive || a.type || '').trim().toLowerCase();
        const byName = {
          rsa: 'ML-KEM (Kyber) for key establishment + ML-DSA (Dilithium) for signatures',
          ecc: 'ML-KEM (Kyber) for key establishment + ML-DSA (Dilithium) for signatures',
          ecdsa: 'ML-DSA (Dilithium) or SPHINCS+ for digital signatures',
          ecdh: 'ML-KEM (Kyber) for key establishment',
          dsa: 'ML-DSA (Dilithium) for digital signatures',
          ed25519: 'ML-DSA (Dilithium) or SPHINCS+ for digital signatures',
          x25519: 'ML-KEM (Kyber) for key establishment',
          md5: 'SHA3-256 or SHA-512 (and HMAC where authenticity is needed)',
          sha1: 'SHA3-256 or SHA-512',
          des: 'AES-256-GCM or ChaCha20-Poly1305',
          '3des': 'AES-256-GCM or ChaCha20-Poly1305',
          blowfish: 'AES-256-GCM or ChaCha20-Poly1305',
          rc4: 'AES-256-GCM or ChaCha20-Poly1305'
        };
        const byPrimitive = {
          asymmetric: 'NIST PQC algorithms (ML-KEM / ML-DSA / SLH-DSA) based on use-case',
          'key-exchange': 'ML-KEM (Kyber) for key establishment',
          hash: 'SHA3-256 or SHA-512 depending on compatibility and performance needs',
          symmetric: 'AES-256-GCM or ChaCha20-Poly1305 with modern key management',
          mac: 'HMAC-SHA-512 or KMAC (SHA-3 family)'
        };

        if (a.quantumSafe === true) {
          return 'Current algorithm is already quantum-safe';
        }

        return byName[name] || byPrimitive[primitive] || 'Use a NIST-standard post-quantum or modern vetted primitive for this use-case';
          return {
            alternative: 'Current algorithm is already quantum-safe',
            basis: 'No migration suggested because this detection is marked quantum-safe.'
          };
        }

        const alternative = byName[name] || byPrimitive[primitive] || 'Use a NIST-standard post-quantum or modern vetted primitive for this use-case';
        const status = a.quantumSafe === false
          ? 'Detected as non-quantum-safe.'
          : a.quantumSafe === 'partial'
            ? 'Detected as partially quantum-resistant.'
            : 'Quantum-safety status is unknown.';

        return {
          alternative,
          basis: status + ' Suggestion is selected by matching the detected algorithm name first, then falling back to its primitive category (' + (primitive || 'unknown') + ') and preferring NIST-standardized or widely recommended modern algorithms.'
        };
      }

      const vscode = acquireVsCodeApi();
      const tableBody = document.getElementById('resultsTableBody');

      // Safe row builder (no backticks)
      function rowHtml(a) {
        return '<tr>' +
          '<td>' + (a.name ?? 'Unknown') + '</td>' +
          '<td>' + (a.primitive ?? 'Unknown') + '</td>' +
          '<td>' + (String(a.quantumSafe ?? 'Unknown')) + '</td>' +
          '<td>' + (a.riskScore ?? '-') + '</td>' +
          '<td>' + ((a.severity ?? '-').toUpperCase()) + '</td>' +
          '<td>' + getSuggestion(a) + '</td>' +
          '<td>' + getSuggestion(a).alternative + '</td>' +
          '<td>' + getSuggestion(a).basis + '</td>' +
        '</tr>';
      }

      function renderTable(list) {
        if (!list || list.length === 0) {
          tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888">No matching algorithms</td></tr>';
          tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888">No matching algorithms</td></tr>';
          return;
        }
        let html = '';
        for (let i = 0; i < list.length; i++) {
          html += rowHtml(list[i]);
        }
        tableBody.innerHTML = html;
      }

      renderTable(allResults);

      // Charts
      const riskCtx = document.getElementById('riskChart').getContext('2d');
      const riskChart = new Chart(riskCtx, {
        type: 'pie',
        data: {
          labels: ['High', 'Medium', 'Low'],
          datasets: [{
            data: [${high}, ${medium}, ${low}],
            backgroundColor: ['#f85149', '#f0ad4e', '#3fb950']
          }]
        },
        options: { plugins: { legend: { labels: { color: '#e6edf3' } } } }
      });

      const pqcCtx = document.getElementById('pqcChart').getContext('2d');
      const pqcChart = new Chart(pqcCtx, {
        type: 'doughnut',
        data: {
          labels: ['Quantum Safe', 'Partial', 'Classical'],
          datasets: [{
            data: [${pqc}, ${partial}, ${classical}],
            backgroundColor: ['#3fb950', '#f0ad4e', '#f85149']
          }]
        },
        options: { plugins: { legend: { labels: { color: '#e6edf3' } } } }
      });

      const typeCtx = document.getElementById('typeChart').getContext('2d');
      const typeChart = new Chart(typeCtx, {
        type: 'bar',
        data: {
          labels: Object.keys(typeCounts),
          datasets: [{
            data: Object.values(typeCounts),
            backgroundColor: '#58a6ff'
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#e6edf3' } },
            y: { ticks: { color: '#e6edf3', beginAtZero: true } }
          }
        }
      });

      const topCtx = document.getElementById('topRiskChart').getContext('2d');
      new Chart(topCtx, {
        type: 'bar',
        data: {
          labels: topRisk.map(r => r.name),
          datasets: [{
            label: 'Risk Score',
            data: topRisk.map(r => r.riskScore ?? r.score ?? 0),
            backgroundColor: '#f85149'
          }]
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#e6edf3', beginAtZero: true, max: 100 } },
            y: { ticks: { color: '#e6edf3' } }
          }
        }
      });

      // CBOM button handler
      document.getElementById('generateCbom').addEventListener('click', () => {
        vscode.postMessage({ command: 'generateCbom' });
      });

      // Reset button
      document.getElementById('resetFilter').addEventListener('click', () => renderTable(allResults));

      // Chart click helper
      function handleChartClick(chart, onSelect) {
        chart.canvas.addEventListener('click', function(evt) {
          const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
          if (points.length) {
            const idx = points[0].index;
            const label = chart.data.labels[idx];
            onSelect(label);
          }
        });
      }

      handleChartClick(riskChart, (label) => {
        const filtered = allResults.filter(a => (a.severity ?? '').toLowerCase() === String(label).toLowerCase());
        renderTable(filtered);
      });

      handleChartClick(pqcChart, (label) => {
        const lbl = String(label);
        const filtered = allResults.filter(a => {
          if (lbl === 'Quantum Safe') return a.quantumSafe === true;
          if (lbl === 'Partial') return a.quantumSafe === 'partial';
          if (lbl === 'Classical') return a.quantumSafe === false;
          return false;
        });
        renderTable(filtered);
      });

      handleChartClick(typeChart, (label) => {
        const filtered = allResults.filter(a => ((a.primitive ?? '').toLowerCase() === String(label).toLowerCase()));
        renderTable(filtered);
      });
    </script>

  </body>
  </html>`;
}
