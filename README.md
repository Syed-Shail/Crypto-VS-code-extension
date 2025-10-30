 Crypto Detector for VS Code

Detect cryptographic algorithms, usage patterns, and their quantum-safety level directly in your code.

---

 Features

-  Automatically scans your files for known cryptographic algorithms.
-  Displays:
  - Algorithm name (e.g., RSA, AES, SHA-256)
  - Location in code (line number, file)
  - Usage count
  - Quantum-safety status ✅❌
-  Nicely formatted terminal summary report.

---

  Example Output


| Algorithm | Type | Quantum-Safe? | Notes |
|------------|------|---------------|-------|
| AES-256 | Symmetric | ✅ | Considered quantum-resistant under Grover’s algorithm |
| RSA | Asymmetric | ❌ | Broken by Shor’s algorithm |
| ECC | Asymmetric | ❌ | Broken by Shor’s algorithm |
| SHA-3 | Hash | ✅ | Secure against known quantum attacks |

---

 Commands

| Command | Description |
|----------|-------------|
| `Crypto Detector: Scan File` | Scans the currently open file |
| `Crypto Detector: Scan Workspace` | Scans all project files |

---

 Author
**Syed Shail**  
[GitHub](https://github.com/syedshail)

---

 License
MIT License © 2025 Syed Shail