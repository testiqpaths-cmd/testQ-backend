#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";

const log = {
  info: (msg) => console.log(`${BLUE}ℹ${RESET} ${msg}`),
  success: (msg) => console.log(`${GREEN}✓${RESET} ${msg}`),
  error: (msg) => console.error(`${RED}✗${RESET} ${msg}`),
  warn: (msg) => console.warn(`${YELLOW}⚠${RESET} ${msg}`),
};

function findAllJsFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  items.forEach(item => {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!item.startsWith(".") && item !== "node_modules" && item !== "logs") {
        findAllJsFiles(fullPath, files);
      }
    } else if (item.endsWith(".js")) {
      files.push(fullPath);
    }
  });

  return files;
}

function checkConsoleStatements(dir) {
  const invalidFiles = [];
  const files = findAllJsFiles(dir);

  files.forEach(file => {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        /console\.(log|error|warn|debug|info)\s*\(/.test(line) &&
        !line.includes("logger.")
      ) {
        if (!invalidFiles.includes(file)) {
          invalidFiles.push(file);
        }
      }
    });
  });

  return invalidFiles;
}

async function runBuild() {
  console.log("\n🏗️  Starting Build Process...\n");

  try {
    // Step 1: Check if src directory exists
    log.info("Checking project structure...");
    const srcPath = path.join(__dirname, "src");
    if (!fs.existsSync(srcPath)) {
      throw new Error("src directory not found");
    }
    log.success("Project structure valid");

    // Step 2: Validate Node.js syntax
    log.info("Validating Node.js syntax...");
    const files = findAllJsFiles(srcPath);
    
    let syntaxErrors = 0;
    files.forEach(file => {
      try {
        execSync(`node --check "${file}"`, { stdio: "pipe" });
      } catch (err) {
        log.error(`Syntax error in ${path.relative(__dirname, file)}`);
        syntaxErrors++;
      }
    });

    if (syntaxErrors > 0) {
      throw new Error(`${syntaxErrors} file(s) have syntax errors`);
    }
    log.success(`Validated ${files.length} JavaScript files`);

    // Step 3: Check for console statements (warning)
    log.info("Checking for console statements...");
    const consoleFiles = checkConsoleStatements(srcPath);
    if (consoleFiles.length > 0) {
      log.warn(`Found console statements in ${consoleFiles.length} file(s):`);
      consoleFiles.forEach(f => console.log(`  - ${path.relative(__dirname, f)}`));
    } else {
      log.success("No active console statements found");
    }

    // Step 4: Check for required config files
    log.info("Checking required configuration files...");
    const requiredFiles = [
      "src/server.js",
      "src/app.js",
      "src/config/env.js",
      "src/config/db.js",
      "src/config/logger.js",
      "package.json"
    ];

    const missingFiles = requiredFiles.filter(
      file => !fs.existsSync(path.join(__dirname, file))
    );

    if (missingFiles.length > 0) {
      missingFiles.forEach(file => {
        log.error(`Missing required file: ${file}`);
      });
      throw new Error("Missing required files");
    }
    log.success("All required files present");

    // Step 5: Create logs directory
    log.info("Ensuring logs directory exists...");
    const logsPath = path.join(__dirname, "logs");
    if (!fs.existsSync(logsPath)) {
      fs.mkdirSync(logsPath, { recursive: true });
      log.success("Created logs directory");
    } else {
      log.success("Logs directory exists");
    }

    // Step 6: Verify package.json
    log.info("Verifying package.json...");
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
    );
    
    const requiredDeps = [
      "express",
      "mongoose",
      "dotenv",
      "jsonwebtoken",
      "cookie-parser",
      "redis",
      "morgan",
      "winston"
    ];

    const missingDeps = requiredDeps.filter(dep => !packageJson.dependencies[dep]);
    if (missingDeps.length > 0) {
      log.warn(`Missing dependencies: ${missingDeps.join(", ")}`);
      log.warn("Run: npm install");
    } else {
      log.success("All required dependencies installed");
    }

    // Success summary
    console.log("\n" + "=".repeat(50));
    log.success("Build validation completed successfully!");
    console.log("=".repeat(50));
    console.log(`
${GREEN}Ready to launch!${RESET}

Commands:
  ${BLUE}npm start${RESET}          - Start production server
  ${BLUE}npm run dev${RESET}        - Start development server (auto-reload)
  ${BLUE}npm run build${RESET}      - Validate build again
  ${BLUE}npm run validate${RESET}   - Run all checks

Logs:
  📄 logs/all.log   - All application logs
  📄 logs/error.log - Error logs only
    `);

  } catch (error) {
    console.error("\n" + "=".repeat(50));
    log.error("Build validation failed!");
    console.error("=".repeat(50));
    console.error(`${RED}${error.message}${RESET}`);
    process.exit(1);
  }
}

runBuild();
