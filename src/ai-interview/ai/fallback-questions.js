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
    ],
    MEDIUM: [
      "What is a closure in JavaScript, and can you give a practical use case for it?",
      "How does the JavaScript event loop handle asynchronous code and microtasks vs macrotasks?",
      "What is the difference between call, apply, and bind functions?",
      "Can you explain prototypal inheritance and how the prototype chain works in JavaScript?",
    ],
    HARD: [
      "How would you implement a custom Promise.all with proper error handling and edge cases?",
      "Can you explain how memory management and garbage collection work in V8, and how memory leaks occur?",
      "How would you optimize a high-frequency event stream in JavaScript using debouncing and throttling?",
    ],
  },
  REACT: {
    EASY: [
      "What are the core advantages of using React and what is the Virtual DOM?",
      "What is the difference between props and state in a React component?",
      "Can you explain what the useState hook does and how to use it?",
      "Why do elements in a React list need unique 'key' props?",
    ],
    MEDIUM: [
      "How does useEffect work, and how do you prevent unnecessary re-renders or infinite loops?",
      "What are the differences between useMemo, useCallback, and React.memo?",
      "How does React's reconciliation algorithm (Fiber) work when updating the DOM?",
      "How do you manage complex application state in React using Context or external state stores?",
    ],
    HARD: [
      "How would you build a custom hook that manages optimistic UI updates with rollback on failure?",
      "Can you explain Concurrent React features like useTransition and Suspense under the hood?",
    ],
  },
  "NODE.JS": {
    EASY: [
      "What is Node.js and why is it described as an asynchronous, event-driven runtime?",
      "What is the role of the package.json file in a Node.js project?",
      "What is the difference between synchronous and asynchronous file operations in Node.js?",
    ],
    MEDIUM: [
      "How does the Node.js event loop work across its different phases (timers, poll, check)?",
      "What are Node.js Streams and how do they help process large files or datasets?",
      "How do you handle unhandled promise rejections and uncaught exceptions in production?",
      "What is the difference between CommonJS (require) and ES Modules (import)?",
    ],
    HARD: [
      "How would you scale a Node.js application across multiple CPU cores using the cluster module or worker threads?",
      "How do you profile a Node.js application for CPU bottlenecks and memory leaks in production?",
    ],
  },
  MONGODB: {
    EASY: [
      "What are the primary differences between SQL relational databases and NoSQL document databases like MongoDB?",
      "What is a document and a collection in MongoDB?",
      "What is the purpose of the _id field in MongoDB documents?",
    ],
    MEDIUM: [
      "How do indexes work in MongoDB and how do you choose between single-field and compound indexes?",
      "Can you explain how MongoDB aggregation pipelines work with stages like $match, $group, and $lookup?",
      "How do you model one-to-many relationships in MongoDB: embedding vs referencing?",
    ],
    HARD: [
      "How does MongoDB handle write concerns and read preferences in a replica set?",
      "How would you design a sharded cluster schema to prevent hotspots in high-write workloads?",
    ],
  },
  PYTHON: {
    EASY: [
      "What are the differences between a list and a tuple in Python?",
      "How does Python manage variable scopes (LEGB rule)?",
      "What are Python list comprehensions and why are they used?",
    ],
    MEDIUM: [
      "What is the Global Interpreter Lock (GIL) in CPython and how does it affect multithreading?",
      "Can you explain how Python decorators work and how to implement one?",
      "What is the difference between deepcopy and shallow copy in Python?",
    ],
    HARD: [
      "How do generators and the yield keyword work in Python memory-wise?",
      "How would you design an asynchronous pipeline using asyncio in Python?",
    ],
  },
  SQL: {
    EASY: [
      "What is the difference between INNER JOIN and LEFT JOIN in SQL?",
      "What is the purpose of the GROUP BY clause and how is it used with aggregate functions?",
      "What is the difference between WHERE and HAVING clauses?",
    ],
    MEDIUM: [
      "What are database indexes, and what data structure (like B-Tree) is commonly used to implement them?",
      "What are ACID properties in relational database transactions?",
      "How do window functions like ROW_NUMBER() and RANK() differ from GROUP BY?",
    ],
    HARD: [
      "How do you identify and optimize a query with high execution time using EXPLAIN and index tuning?",
      "How do transaction isolation levels (Read Committed vs Serializable) prevent phantom reads?",
    ],
  },
  TECHNICAL_FUNDAMENTALS: {
    EASY: [
      "Can you explain the difference between synchronous and asynchronous programming?",
      "What is an API, and what is the difference between GET and POST HTTP methods?",
      "What is version control and why is Git widely used in software development?",
    ],
    MEDIUM: [
      "How does DNS resolution work from the moment you type a URL in the browser until the page loads?",
      "What are the differences between REST and GraphQL architectures?",
      "What is the difference between process and thread in operating systems?",
    ],
    HARD: [
      "How would you design a caching strategy using Redis to prevent cache stampede / thundering herd problem?",
      "Can you explain the CAP theorem and how modern distributed databases handle network partitions?",
    ],
  },
  PROBLEM_SOLVING: {
    EASY: [
      "How would you check if a given string is a palindrome?",
      "How would you find the maximum and minimum numbers in an unsorted array?",
    ],
    MEDIUM: [
      "How would you find the first non-repeating character in a stream of characters?",
      "What is the difference between BFS and DFS traversal, and when would you pick one over the other?",
    ],
    HARD: [
      "How would you detect a cycle in a directed graph?",
      "How would you design an LRU cache with O(1) get and put operations?",
    ],
  },
  BEHAVIORAL: {
    EASY: [
      "Tell me about a technical project you recently worked on. What was your role in it?",
      "How do you approach learning a new programming language or framework under a deadline?",
    ],
    MEDIUM: [
      "Describe a challenging technical bug you encountered in a project and how you diagnosed and resolved it.",
      "Tell me about a time you had a technical disagreement with a team member. How did you resolve it?",
    ],
    HARD: [
      "Walk me through a situation where a production deployment failed. How did you handle incident response and post-mortem?",
    ],
  },
  HR: {
    EASY: [
      "What motivated you to apply for this role and what are your immediate career goals?",
      "How do you stay updated with current software engineering trends and best practices?",
    ],
    MEDIUM: [
      "Where do you see your technical leadership or engineering skills evolving over the next two to three years?",
    ],
    HARD: [
      "How do you balance high code quality with tight commercial deadlines in a fast-paced environment?",
    ],
  },
};

/**
 * Retrieves a fallback question for a given topic and difficulty level.
 * @param {string} topic
 * @param {string} difficulty - "EASY" | "MEDIUM" | "HARD" | "ADAPTIVE"
 * @param {string[]} [excludeQuestions=[]] - Questions already asked in this session
 * @returns {{ question: string, topic: string, difficulty: string, questionType: string, competency: string }}
 */
export const getFallbackQuestion = (
  topic = "TECHNICAL_FUNDAMENTALS",
  difficulty = "EASY",
  excludeQuestions = []
) => {
  const normTopic = String(topic).toUpperCase().replace(/\s+/g, "_");
  const normDiff = difficulty === "ADAPTIVE" ? "EASY" : String(difficulty).toUpperCase();

  const topicBank =
    FALLBACK_QUESTION_BANK[normTopic] ||
    FALLBACK_QUESTION_BANK.TECHNICAL_FUNDAMENTALS;

  const diffQuestions =
    topicBank[normDiff] ||
    topicBank.EASY ||
    FALLBACK_QUESTION_BANK.TECHNICAL_FUNDAMENTALS.EASY;

  // Filter out questions already asked in this session
  const available = diffQuestions.filter(
    (q) => !excludeQuestions.some((asked) => asked.toLowerCase() === q.toLowerCase())
  );

  const pool = available.length > 0 ? available : diffQuestions;
  const selectedQuestion = pool[Math.floor(Math.random() * pool.length)];

  return {
    question: selectedQuestion,
    topic: normTopic,
    difficulty: normDiff,
    questionType: normTopic === "BEHAVIORAL" ? "BEHAVIORAL" : normTopic === "HR" ? "HR" : "TECHNICAL",
    competency: "Technical Knowledge",
  };
};

export default getFallbackQuestion;
