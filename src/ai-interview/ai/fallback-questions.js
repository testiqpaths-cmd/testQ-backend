/**
 * Predefined fallback questions bank mapped by topic and difficulty level.
 * Used whenever external AI generation fails, times out, or returns invalid schema.
 */
export const FALLBACK_QUESTION_BANK = {
  JAVASCRIPT: {
    EASY: [
      "Can you explain the difference between var, let, and const in JavaScript?",
      "What are the different primitive data types available in JavaScript?",
      "What is the difference between '==' and '===' operators in JavaScript?",
      "Can you explain how the concept of hoisting works in JavaScript?",
      "What is the difference between null and undefined in JavaScript?",
      "How do arrow functions differ from regular functions regarding the 'this' keyword?",
    ],
    MEDIUM: [
      "What is a closure in JavaScript, and can you give a practical use case for it?",
      "How does the JavaScript event loop handle asynchronous code and microtasks vs macrotasks?",
      "What is the difference between call, apply, and bind functions?",
      "Can you explain prototypal inheritance and how the prototype chain works in JavaScript?",
      "How do JavaScript Promises work under the hood, and what problems do they solve compared to callbacks?",
      "What are JavaScript WeakMap and WeakSet, and when would you use them over regular Map and Set?",
    ],
    HARD: [
      "How would you implement a custom Promise.all with proper error handling and edge cases?",
      "Can you explain how memory management and garbage collection work in V8, and how memory leaks occur?",
      "How would you optimize a high-frequency event stream in JavaScript using debouncing and throttling?",
      "Can you explain how JavaScript engines optimize execution using JIT compilation and hidden classes?",
      "How does Web Worker communication work using postMessage and ArrayBuffer Transferable Objects?",
    ],
  },
  TYPESCRIPT: {
    EASY: [
      "What are the core differences between TypeScript and JavaScript, and what benefits does TypeScript provide?",
      "What is the difference between 'interface' and 'type' alias in TypeScript?",
      "Can you explain the difference between 'any', 'unknown', and 'never' types?",
      "How do optional chaining (?.) and nullish coalescing (??) work in TypeScript?",
    ],
    MEDIUM: [
      "What are TypeScript Generics and how do they help build reusable, type-safe functions and classes?",
      "Can you explain utility types like Partial, Pick, Omit, and Record in TypeScript?",
      "How do type guards and discriminating unions work to narrow types in TypeScript?",
      "What is the difference between declaration merging in interfaces vs types?",
    ],
    HARD: [
      "How would you implement a type-safe deep partial or deep readonly mapped type in TypeScript?",
      "Can you explain conditional types and the 'infer' keyword with a practical example?",
      "How do template literal types work in TypeScript for creating typed route or event systems?",
    ],
  },
  REACT: {
    EASY: [
      "What are the core advantages of using React and what is the Virtual DOM?",
      "What is the difference between props and state in a React component?",
      "Can you explain what the useState hook does and how to use it?",
      "Why do elements in a React list need unique 'key' props?",
      "What is the difference between controlled and uncontrolled components in React forms?",
    ],
    MEDIUM: [
      "How does useEffect work, and how do you prevent unnecessary re-renders or infinite loops?",
      "What are the differences between useMemo, useCallback, and React.memo?",
      "How does React's reconciliation algorithm (Fiber) work when updating the DOM?",
      "How do you manage complex application state in React using Context or external state stores?",
      "What are React Error Boundaries, and what kinds of errors can they catch?",
    ],
    HARD: [
      "How would you build a custom hook that manages optimistic UI updates with rollback on failure?",
      "Can you explain Concurrent React features like useTransition and Suspense under the hood?",
      "How would you diagnose and eliminate unnecessary component re-renders across a large React component tree?",
      "How does React Server Components (RSC) architecture differ from traditional client-side and SSR rendering?",
    ],
  },
  "NODE.JS": {
    EASY: [
      "What is Node.js and why is it described as an asynchronous, event-driven runtime?",
      "What is the role of the package.json file in a Node.js project?",
      "What is the difference between synchronous and asynchronous file operations in Node.js?",
      "What is middleware in Express.js and how does the next() function work?",
    ],
    MEDIUM: [
      "How does the Node.js event loop work across its different phases (timers, poll, check)?",
      "What are Node.js Streams and how do they help process large files or datasets?",
      "How do you handle unhandled promise rejections and uncaught exceptions in production?",
      "What is the difference between CommonJS (require) and ES Modules (import)?",
      "How does Node.js utilize the libuv thread pool for I/O operations?",
    ],
    HARD: [
      "How would you scale a Node.js application across multiple CPU cores using the cluster module or worker threads?",
      "How do you profile a Node.js application for CPU bottlenecks and memory leaks in production?",
      "How would you handle backpressure when streaming data from a fast producer to a slow consumer?",
    ],
  },
  MONGODB: {
    EASY: [
      "What are the primary differences between SQL relational databases and NoSQL document databases like MongoDB?",
      "What is a document and a collection in MongoDB?",
      "What is the purpose of the _id field in MongoDB documents?",
      "How do basic CRUD operations work in MongoDB?",
    ],
    MEDIUM: [
      "How do indexes work in MongoDB and how do you choose between single-field and compound indexes?",
      "Can you explain how MongoDB aggregation pipelines work with stages like $match, $group, and $lookup?",
      "How do you model one-to-many relationships in MongoDB: embedding vs referencing?",
      "What is the difference between an embedded index and a multikey index in MongoDB?",
    ],
    HARD: [
      "How does MongoDB handle write concerns and read preferences in a replica set?",
      "How would you design a sharded cluster schema to prevent hotspots in high-write workloads?",
      "How do multi-document ACID transactions work in MongoDB replica sets and what are their performance impacts?",
    ],
  },
  SQL: {
    EASY: [
      "What is the difference between INNER JOIN and LEFT JOIN in SQL?",
      "What is the purpose of the GROUP BY clause and how is it used with aggregate functions?",
      "What is the difference between WHERE and HAVING clauses?",
      "What are primary keys and foreign keys, and why are constraints important?",
    ],
    MEDIUM: [
      "What are database indexes, and what data structure (like B-Tree) is commonly used to implement them?",
      "What are ACID properties in relational database transactions?",
      "How do window functions like ROW_NUMBER() and RANK() differ from GROUP BY?",
      "What is database normalization (1NF, 2NF, 3NF) and when would you intentionally denormalize?",
    ],
    HARD: [
      "How do you identify and optimize a query with high execution time using EXPLAIN and index tuning?",
      "How do transaction isolation levels (Read Committed vs Serializable) prevent phantom reads?",
      "How would you design database table partitioning and indexing for a table with hundreds of millions of rows?",
    ],
  },
  PYTHON: {
    EASY: [
      "What are the differences between a list and a tuple in Python?",
      "How does Python manage variable scopes (LEGB rule)?",
      "What are Python list comprehensions and why are they used?",
      "What is the difference between 'is' and '==' in Python?",
    ],
    MEDIUM: [
      "What is the Global Interpreter Lock (GIL) in CPython and how does it affect multithreading?",
      "Can you explain how Python decorators work and how to implement one?",
      "What is the difference between deepcopy and shallow copy in Python?",
      "How do generators and the yield keyword work in Python memory-wise?",
    ],
    HARD: [
      "How would you design an asynchronous pipeline using asyncio in Python?",
      "Can you explain Python metaclasses and how __new__ and __init__ differ in class creation?",
      "How does Python's memory management handle reference cycles through generational garbage collection?",
    ],
  },
  AWS: {
    EASY: [
      "What are the key differences between AWS S3, EBS, and EFS storage services?",
      "What is an AWS IAM role and how does it differ from an IAM user?",
      "What is the purpose of Amazon CloudWatch and how is it used for monitoring?",
    ],
    MEDIUM: [
      "How does an AWS Application Load Balancer differ from a Network Load Balancer?",
      "Can you explain how AWS Lambda operates in terms of cold starts and concurrency limits?",
      "How do you design a secure Virtual Private Cloud (VPC) with public and private subnets and a NAT Gateway?",
    ],
    HARD: [
      "How would you design a multi-region active-active disaster recovery architecture on AWS?",
      "How would you optimize cost and latency for an image processing pipeline handling millions of uploads daily?",
    ],
  },
  DOCKER: {
    EASY: [
      "What is the difference between a Docker image and a Docker container?",
      "What is the purpose of a Dockerfile and what are common instructions like FROM, RUN, and CMD?",
      "What is the difference between CMD and ENTRYPOINT in Docker?",
    ],
    MEDIUM: [
      "How do multi-stage Docker builds help reduce image size and improve security?",
      "What is Docker Compose and how does it orchestrate multiple interdependent containers?",
      "How do Docker volume mounts differ from bind mounts and tmpfs mounts?",
    ],
    HARD: [
      "How do Linux namespaces and cgroups underpin container isolation under the hood in Docker?",
      "How would you securely handle environment variables and secrets inside Docker containers in production?",
    ],
  },
  GIT: {
    EASY: [
      "What is the difference between 'git merge' and 'git rebase'?",
      "What is the Git staging area and how does 'git add' prepare changes?",
      "What does 'git stash' do and when would you use it?",
    ],
    MEDIUM: [
      "How would you undo a commit that has already been pushed to a remote branch?",
      "What is the difference between 'git reset --soft', '--mixed', and '--hard'?",
      "Can you explain how Git stores objects (blobs, trees, commits) internally?",
    ],
    HARD: [
      "How would you use 'git bisect' to track down a regression in a large repository?",
      "How would you recover a lost commit that was orphaned after a hard reset or rebase?",
    ],
  },
  SYSTEM_DESIGN: {
    EASY: [
      "What is horizontal scaling vs vertical scaling, and what are their trade-offs?",
      "What is the role of a reverse proxy like NGINX in web infrastructure?",
      "What is a Content Delivery Network (CDN) and how does it improve web application latency?",
    ],
    MEDIUM: [
      "How would you design a URL shortener service that scales to millions of requests?",
      "What is the difference between SQL and NoSQL databases from an architecture and consistency standpoint?",
      "How do you implement rate limiting in a distributed system to protect public APIs?",
    ],
    HARD: [
      "How would you design a distributed real-time messaging system like Slack or WhatsApp?",
      "Can you explain the CAP theorem and how modern distributed databases handle network partitions?",
      "How would you design a caching strategy using Redis to prevent cache stampede and the thundering herd problem?",
    ],
  },
  DEV_OPS: {
    EASY: [
      "What is Continuous Integration and Continuous Deployment (CI/CD) and why is it essential?",
      "What is Infrastructure as Code (IaC) and what problems does it solve?",
    ],
    MEDIUM: [
      "How do Blue-Green deployments differ from Canary deployments in minimizing downtime and risk?",
      "How do Prometheus and Grafana work together for system observability and alerting?",
    ],
    HARD: [
      "How would you design an automated zero-downtime database migration strategy for high-traffic services?",
    ],
  },
  TECHNICAL_FUNDAMENTALS: {
    EASY: [
      "Can you explain the difference between synchronous and asynchronous programming?",
      "What is an API, and what is the difference between GET and POST HTTP methods?",
      "What is version control and why is Git widely used in software development?",
      "What is the difference between HTTP and HTTPS, and how does SSL/TLS encryption work at a high level?",
      "What is the purpose of caching in software applications?",
    ],
    MEDIUM: [
      "How does DNS resolution work from the moment you type a URL in the browser until the page loads?",
      "What are the differences between REST and GraphQL architectures?",
      "What is the difference between a process and a thread in modern operating systems?",
      "How do cookies, localStorage, and sessionStorage differ in browser client storage?",
      "Can you explain CORS (Cross-Origin Resource Sharing) and why browsers enforce it?",
    ],
    HARD: [
      "How would you design a distributed locking mechanism using Redis or Zookeeper?",
      "Can you explain the Raft consensus algorithm and how leader election works in distributed systems?",
      "How does TCP three-way handshake and four-way termination work, and how does TCP handle congestion control?",
    ],
  },
  PROBLEM_SOLVING: {
    EASY: [
      "How would you check if a given string is a palindrome?",
      "How would you find the maximum and minimum numbers in an unsorted array?",
      "How do you determine if two strings are anagrams of each other?",
      "How would you reverse the words in a sentence without using built-in reverse functions?",
    ],
    MEDIUM: [
      "How would you find the first non-repeating character in a stream of characters?",
      "What is the difference between BFS and DFS traversal, and when would you pick one over the other?",
      "How would you find the longest substring without repeating characters in O(n) time?",
      "How would you implement a binary search algorithm and what are its boundary conditions?",
    ],
    HARD: [
      "How would you detect a cycle in a directed graph using topological sort or DFS?",
      "How would you design an LRU cache with O(1) get and put operations?",
      "How would you solve the median of two sorted arrays problem with logarithmic time complexity?",
    ],
  },
  BEHAVIORAL: {
    EASY: [
      "Tell me about a technical project you recently worked on. What was your role in it?",
      "How do you approach learning a new programming language or framework under a deadline?",
      "What qualities do you look for in a team culture and engineering environment?",
    ],
    MEDIUM: [
      "Describe a challenging technical bug you encountered in a project and how you diagnosed and resolved it.",
      "Tell me about a time you had a technical disagreement with a team member. How did you resolve it?",
      "Can you give an example of a time when you received constructive feedback on code review and how you handled it?",
    ],
    HARD: [
      "Walk me through a situation where a production deployment failed. How did you handle incident response and post-mortem?",
      "Tell me about a time you had to make a significant technical trade-off between architectural purity and speed of delivery.",
    ],
  },
  HR: {
    EASY: [
      "What motivated you to apply for this role and what are your immediate career goals?",
      "How do you stay updated with current software engineering trends and best practices?",
      "What kinds of projects or challenges keep you most energized and engaged at work?",
    ],
    MEDIUM: [
      "Where do you see your technical leadership or engineering skills evolving over the next two to three years?",
      "Describe a time when you had to manage competing priorities across multiple simultaneous deadlines.",
    ],
    HARD: [
      "How do you balance high code quality with tight commercial deadlines in a fast-paced environment?",
    ],
  },
};

const normalize = (str) =>
  String(str || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function deriveConcept(questionText, topic) {
  const norm = normalize(questionText);
  if (norm.includes("closure")) return "Closures";
  if (norm.includes("event loop")) return "Event Loop";
  if (norm.includes("promise")) return "Promises & Asynchrony";
  if (norm.includes("hoisting")) return "Hoisting";
  if (norm.includes("prototype")) return "Prototypal Inheritance";
  if (norm.includes("virtual dom")) return "Virtual DOM";
  if (norm.includes("useeffect") || norm.includes("hook")) return "React Hooks Lifecycle";
  if (norm.includes("fiber") || norm.includes("reconciliation")) return "Reconciliation";
  if (norm.includes("stream")) return "Streams & Buffers";
  if (norm.includes("index")) return "Database Indexing";
  if (norm.includes("acid") || norm.includes("transaction")) return "Transactions & Concurrency";
  if (norm.includes("join")) return "SQL Joins";
  if (norm.includes("cache") || norm.includes("caching")) return "Caching Architecture";
  if (norm.includes("docker") || norm.includes("container")) return "Containerization";
  if (norm.includes("dns")) return "Networking & DNS";
  if (norm.includes("merge") || norm.includes("rebase")) return "Git Workflows";
  return topic.replace(/_/g, " ");
}

/**
 * Retrieves a fallback question for a given topic and difficulty level.
 * Guarantees never repeating an already asked question if ANY unasked question exists.
 *
 * @param {string} topic
 * @param {string} difficulty - "EASY" | "MEDIUM" | "HARD" | "ADAPTIVE"
 * @param {string[]} [excludeQuestions=[]] - Questions already asked in this session
 * @returns {{ question: string, concept: string, topic: string, difficulty: string, questionType: string, competency: string }}
 */
export const getFallbackQuestion = (
  topic = "TECHNICAL_FUNDAMENTALS",
  difficulty = "EASY",
  excludeQuestions = []
) => {
  const normTopic = String(topic).toUpperCase().replace(/\s+/g, "_");
  const normDiff = difficulty === "ADAPTIVE" ? "EASY" : String(difficulty).toUpperCase();

  const isExcluded = (q) => {
    const nq = normalize(q);
    return excludeQuestions.some((asked) => {
      const na = normalize(asked);
      return na === nq || (na && nq && (na.includes(nq) || nq.includes(na)));
    });
  };

  // 1. Check matching topic bank
  const topicBank =
    FALLBACK_QUESTION_BANK[normTopic] ||
    FALLBACK_QUESTION_BANK.TECHNICAL_FUNDAMENTALS;

  // Primary difficulty list
  const primaryList = topicBank[normDiff] || topicBank.EASY || [];
  let available = primaryList.filter((q) => !isExcluded(q));

  // 2. If primary difficulty in topic is exhausted, search adjacent difficulties in same topic
  if (available.length === 0) {
    const diffLadder = ["EASY", "MEDIUM", "HARD"];
    for (const d of diffLadder) {
      if (d === normDiff) continue;
      const list = topicBank[d] || [];
      const unasked = list.filter((q) => !isExcluded(q));
      if (unasked.length > 0) {
        available = unasked;
        break;
      }
    }
  }

  // 3. If whole topic is exhausted, search TECHNICAL_FUNDAMENTALS
  if (available.length === 0 && normTopic !== "TECHNICAL_FUNDAMENTALS") {
    const tfBank = FALLBACK_QUESTION_BANK.TECHNICAL_FUNDAMENTALS;
    for (const d of [normDiff, "EASY", "MEDIUM", "HARD"]) {
      const list = tfBank[d] || [];
      const unasked = list.filter((q) => !isExcluded(q));
      if (unasked.length > 0) {
        available = unasked;
        break;
      }
    }
  }

  // 4. If still exhausted, search PROBLEM_SOLVING
  if (available.length === 0 && normTopic !== "PROBLEM_SOLVING") {
    const psBank = FALLBACK_QUESTION_BANK.PROBLEM_SOLVING;
    for (const d of [normDiff, "EASY", "MEDIUM", "HARD"]) {
      const list = psBank[d] || [];
      const unasked = list.filter((q) => !isExcluded(q));
      if (unasked.length > 0) {
        available = unasked;
        break;
      }
    }
  }

  // 5. Ultimate fallback: pick from primaryList if all possible questions were somehow asked
  const pool = available.length > 0 ? available : (primaryList.length > 0 ? primaryList : ["Can you explain the architectural overview of a project you built recently?"]);
  const selectedQuestion = pool[Math.floor(Math.random() * pool.length)];

  return {
    question: selectedQuestion,
    concept: deriveConcept(selectedQuestion, normTopic),
    topic: normTopic,
    difficulty: normDiff,
    questionType: normTopic === "BEHAVIORAL" ? "BEHAVIORAL" : normTopic === "HR" ? "HR" : "TECHNICAL",
    competency: "Technical Knowledge",
  };
};

export default getFallbackQuestion;
