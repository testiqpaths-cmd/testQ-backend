import { resolveInterviewTypeForTopic, INTERVIEW_TYPES } from "../constants/interview-types.js";

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
      "What is the aggregation framework in MongoDB and what are common pipeline stages like $match and $group?",
      "How does MongoDB handle data replication using replica sets?",
      "What is the difference between embedding documents and referencing documents in data modeling?",
    ],
    HARD: [
      "How does MongoDB sharding work to horizontally scale collections across clusters?",
      "How do write concern and read concern work in MongoDB to ensure consistency across distributed nodes?",
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
  HIGH_LEVEL_ARCHITECTURE: {
    EASY: [
      "What is horizontal scaling vs vertical scaling, and what are their architectural trade-offs?",
      "What is the role of a reverse proxy like NGINX in web infrastructure?",
      "What is a 3-tier architecture and what role does each tier play?",
    ],
    MEDIUM: [
      "How would you design a URL shortener service like Bitly that scales to millions of requests?",
      "What is the difference between monolithic and microservice architectures, and when should you transition?",
      "How does an API gateway centralize routing, authentication, and rate limiting in modern architectures?",
    ],
    HARD: [
      "How would you design a distributed real-time messaging system like WhatsApp or Slack?",
      "How do you design a high-throughput notification system that reliably handles millions of push alerts and emails?",
    ],
  },
  SCALABILITY: {
    EASY: [
      "What is a Content Delivery Network (CDN) and how does it reduce server load and latency?",
      "What is load balancing and how does Round Robin differ from Least Connections?",
    ],
    MEDIUM: [
      "How do you implement rate limiting in a distributed system to protect public APIs from abuse?",
      "What caching patterns (write-through, write-back, cache-aside) do you use to scale read-heavy applications?",
      "How do database read replicas help scale high-traffic web applications?",
    ],
    HARD: [
      "How do you prevent cache stampede and the thundering herd problem in high-throughput systems?",
      "How would you design auto-scaling policies to handle massive sudden traffic spikes without over-provisioning?",
    ],
  },
  DATABASE_DESIGN: {
    EASY: [
      "What are the primary differences between SQL relational databases and NoSQL document databases?",
      "What are primary keys, foreign keys, and unique constraints in database modeling?",
    ],
    MEDIUM: [
      "What are database indexes, and how do B-Trees enable efficient range and point queries?",
      "What are ACID properties and how do transaction isolation levels prevent race conditions?",
      "What is the difference between database normalization (3NF) and intentional denormalization?",
    ],
    HARD: [
      "How would you design database table partitioning and sharding for tables storing hundreds of millions of records?",
      "How do distributed databases manage consensus and replication lag across multi-region deployments?",
    ],
  },
  CACHING_STRATEGIES: {
    EASY: [
      "What is the primary benefit of caching in a web application and where can caches reside?",
      "What is the difference between client-side caching and server-side caching?",
    ],
    MEDIUM: [
      "How do cache eviction policies like LRU (Least Recently Used) and LFU (Least Frequently Used) work?",
      "What are the differences between cache-aside, read-through, and write-through caching patterns?",
    ],
    HARD: [
      "How do you maintain cache consistency across multiple distributed application nodes?",
      "How do you handle cache penetration, cache breakdown, and cache avalanche in production?",
    ],
  },
  MICROSERVICES: {
    EASY: [
      "What are the key benefits and trade-offs of decomposing a monolith into microservices?",
      "What is service discovery in a microservices ecosystem?",
    ],
    MEDIUM: [
      "How do microservices communicate reliably using asynchronous message queues like Kafka or RabbitMQ?",
      "What is the circuit breaker pattern and how does it prevent cascading failures across services?",
    ],
    HARD: [
      "How do you maintain distributed transaction integrity across microservices using the Saga pattern?",
      "How do you implement distributed tracing and observability using OpenTelemetry across microservices?",
    ],
  },
  FAULT_TOLERANCE: {
    EASY: [
      "What does high availability mean in software systems and how is uptime measured?",
      "What is the role of health checks in distributed systems?",
    ],
    MEDIUM: [
      "How do retry mechanisms with exponential backoff and jitter prevent overwhelming struggling services?",
      "What is the difference between active-passive and active-active failover strategies?",
    ],
    HARD: [
      "How do you design a disaster recovery plan with near-zero RPO (Recovery Point Objective) and RTO (Recovery Time Objective)?",
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
  DATA_STRUCTURES: {
    EASY: [
      "What is the difference between an Array and a Linked List in memory allocation and access time?",
      "How does a Hash Map work under the hood and how does it handle hash collisions?",
      "What is the difference between a Stack (LIFO) and a Queue (FIFO)?",
    ],
    MEDIUM: [
      "What is a Binary Search Tree (BST) and what are its worst-case vs average-case time complexities?",
      "How does a Min-Heap or Max-Heap work, and what are common real-world use cases like priority queues?",
      "How are graphs represented in code (adjacency matrix vs adjacency list), and what are the trade-offs?",
    ],
    HARD: [
      "How would you implement an LRU (Least Recently Used) cache with O(1) get and put time complexity?",
      "Can you explain Trie (Prefix Tree) data structures and how they power search autocomplete engines?",
    ],
  },
  ALGORITHMS: {
    EASY: [
      "How would you find the maximum and minimum elements in an unsorted array?",
      "How do you determine if two strings are anagrams of each other?",
      "How would you reverse the words in a sentence without using built-in reverse helpers?",
    ],
    MEDIUM: [
      "How does Binary Search work and what preconditions must be met before applying it?",
      "What are the differences between Breadth-First Search (BFS) and Depth-First Search (DFS)?",
      "How do you find the first non-repeating character in a stream of characters?",
    ],
    HARD: [
      "How would you detect a cycle in a directed graph using topological sorting or DFS?",
      "How do you solve the longest substring without repeating characters in O(n) time?",
      "How would you solve the median of two sorted arrays problem with logarithmic time complexity?",
    ],
  },
  TIME_COMPLEXITY: {
    EASY: [
      "What is Big-O notation and why is it important for evaluating software performance?",
      "What is the difference between O(1) constant time and O(n) linear time complexity?",
    ],
    MEDIUM: [
      "Why is O(n log n) considered the optimal comparison-based sorting complexity (e.g. Merge Sort)?",
      "What is space complexity and how does recursion affect call stack memory?",
    ],
    HARD: [
      "How do you analyze the amortized time complexity of dynamic array resizing or hash table operations?",
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
  LEADERSHIP: {
    EASY: [
      "What does good leadership mean to you, whether in a formal lead role or as an individual contributor?",
      "Can you share an example of a time you took initiative on a task or project without being prompted?",
    ],
    MEDIUM: [
      "Tell me about a time you guided teammates or mentored a colleague through an ambiguous technical challenge.",
      "How do you maintain team morale and motivation when a project faces roadblocks or missed targets?",
    ],
    HARD: [
      "Describe a time you had to make an unpopular decision for the long-term benefit of a project or team. How did you manage it?",
    ],
  },
  COLLABORATION: {
    EASY: [
      "How do you establish trust and effective working relationships when joining a new engineering team?",
      "What tools and communication habits do you rely on for smooth day-to-day team collaboration?",
    ],
    MEDIUM: [
      "Describe a time you collaborated with another department or team that had competing priorities. How did you align?",
    ],
    HARD: [
      "Tell me about a time cross-functional misalignment threatened project delivery. How did you bring stakeholders together?",
    ],
  },
  ADAPTABILITY: {
    EASY: [
      "How do you handle unexpected changes in project requirements or priorities?",
      "Describe your approach to getting up to speed on an unfamiliar codebase or toolchain quickly.",
    ],
    MEDIUM: [
      "Tell me about a time a project's technical direction changed completely midway through. How did you adjust?",
    ],
    HARD: [
      "Walk me through an urgent production crisis where you had to make quick decisions with incomplete information.",
    ],
  },
  OVERCOMING_CHALLENGES: {
    EASY: [
      "Tell me about a difficult obstacle you encountered recently and how you broke it down to solve it.",
    ],
    MEDIUM: [
      "Describe a project that did not go according to plan. What went wrong and what lessons did you take away?",
    ],
    HARD: [
      "Tell me about a time you made a significant mistake at work. How did you handle the consequences and rectify it?",
    ],
  },
  DECISION_MAKING: {
    EASY: [
      "What process or framework do you use when making important technical or workflow decisions under uncertainty?",
    ],
    MEDIUM: [
      "Tell me about a time you had to make an engineering decision with incomplete data. How did you evaluate the risks?",
    ],
    HARD: [
      "Describe a high-stakes decision you made where there was no clear right answer. What were the trade-offs and outcome?",
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
  CULTURE_FIT: {
    EASY: [
      "What kind of team culture and work environment helps you perform at your best?",
      "How do you align with a company's mission and core values in your daily work?",
      "What do you value most in a relationship between team members and leadership?",
    ],
    MEDIUM: [
      "Describe a time when you joined a new company or team. How did you integrate into their work culture?",
      "How do you handle situations where company goals or organizational structures shift unexpectedly?",
    ],
    HARD: [
      "Tell me about a time you noticed an issue in team morale or culture. What proactive steps did you take to help improve it?",
    ],
  },
  CAREER_GOALS: {
    EASY: [
      "Where do you see yourself professionally over the next two to three years?",
      "What specifically attracted you to this company and this role?",
    ],
    MEDIUM: [
      "What skills or capabilities are you currently actively working to develop or improve?",
      "How does this position fit into your overall long-term career aspirations?",
    ],
    HARD: [
      "Describe a major career crossroad you faced. How did you evaluate your options and decide the best path forward?",
    ],
  },
  WORK_ETHIC: {
    EASY: [
      "How do you organize, track, and prioritize your daily tasks and responsibilities?",
      "What does taking personal ownership of your work look like in practice?",
    ],
    MEDIUM: [
      "Tell me about a time when you had to deliver results under tight deadlines and pressure.",
      "How do you maintain high quality and precision when handling repetitive or fast-moving tasks?",
    ],
    HARD: [
      "Describe a situation where a critical project was slipping behind schedule. What steps did you take to turn it around?",
    ],
  },
  TEAMWORK: {
    EASY: [
      "What qualities do you believe make someone an exceptional team player in an engineering organization?",
      "How do you collaborate with teammates who have different working styles or backgrounds?",
    ],
    MEDIUM: [
      "Describe a successful team project you contributed to. How did you ensure everyone stayed aligned and supported?",
      "Tell me about a time you stepped in to help a colleague who was overwhelmed with their workload.",
    ],
    HARD: [
      "How do you handle a situation where a team member is consistently underperforming or missing commitments?",
    ],
  },
  COMMUNICATION_SKILLS: {
    EASY: [
      "How do you communicate complex technical concepts or trade-offs to non-technical stakeholders?",
      "What is your approach to giving and receiving constructive feedback during code reviews?",
    ],
    MEDIUM: [
      "Tell me about a time there was a miscommunication on your team. How did you clarify and resolve the issue?",
      "How do you ensure clear and transparent communication when working in distributed or asynchronous teams?",
    ],
    HARD: [
      "Describe a situation where you had to persuade senior decision-makers who initially opposed your proposal.",
    ],
  },
  CONFLICT_RESOLUTION: {
    EASY: [
      "How do you typically react when a colleague disagrees with your technical perspective on a feature?",
      "What steps do you take to prevent friction from turning into personal conflict in a team setting?",
    ],
    MEDIUM: [
      "Tell me about a time you had a workplace disagreement with a coworker. How did you work through it professionally?",
      "Describe a situation where you had to find a constructive compromise between two conflicting approaches.",
    ],
    HARD: [
      "Walk me through an interpersonal conflict on a team that became tense. How did you de-escalate and resolve it?",
    ],
  },
  TEAM_LEADERSHIP: {
    EASY: [
      "How do you support the professional growth and career progression of your team members?",
      "What is your philosophy on delegating responsibilities versus maintaining direct oversight?",
    ],
    MEDIUM: [
      "How do you balance sprint velocity with preventing burnout across an engineering team?",
      "Tell me about a time you mentored an engineer and helped them overcome a performance plateaus.",
    ],
    HARD: [
      "How do you handle performance management when an engineer continues to fall short of expectations after coaching?",
    ],
  },
  PROJECT_DELIVERY: {
    EASY: [
      "How do you break down high-level business requirements into manageable engineering milestones and sprints?",
    ],
    MEDIUM: [
      "How do you manage scope creep and unforeseen technical dependencies during an active release cycle?",
    ],
    HARD: [
      "Describe a time when a critical release missed its target launch date. How did you conduct the post-mortem and course-correct?",
    ],
  },
  STAKEHOLDER_COMMUNICATION: {
    EASY: [
      "How do you keep product managers and executive stakeholders updated on technical milestones and risks?",
    ],
    MEDIUM: [
      "Tell me about a time you had to communicate delays or technical debt to business stakeholders. How did you frame it?",
    ],
    HARD: [
      "How do you balance competing feature requests from product, sales, and engineering architecture?",
    ],
  },
  PROJECT_ARCHITECTURE: {
    EASY: [
      "Can you give an architectural overview of the most impactful application or system you have built?",
    ],
    MEDIUM: [
      "What were the key architectural trade-offs you made in your latest project, and what would you do differently today?",
      "How did your project structure its API layer, database models, and authentication flow?",
    ],
    HARD: [
      "Walk me through how your project architecture handles unexpected traffic spikes and database connection pooling under load.",
    ],
  },
  TECHNICAL_CHALLENGES: {
    EASY: [
      "Tell me about a challenging technical hurdle you solved in a recent project and how you tackled it.",
    ],
    MEDIUM: [
      "Describe the most difficult performance bottleneck or memory leak you diagnosed and resolved in production.",
    ],
    HARD: [
      "Walk me through a critical production outage or data integrity bug you investigated. What was the root cause and fix?",
    ],
  },
  DESIGN_PATTERNS: {
    EASY: [
      "What are software design patterns and why are patterns like Singleton or Factory used?",
      "What is the Observer pattern and how is it used in modern event-driven architectures?",
    ],
    MEDIUM: [
      "How do Dependency Injection and Inversion of Control (IoC) improve code maintainability and testability?",
      "What is the Repository pattern and how does it decouple business logic from data access layers?",
    ],
    HARD: [
      "Can you explain the CQRS (Command Query Responsibility Segregation) pattern and when it is appropriate to use?",
    ],
  },
  PRODUCTION_ISSUES: {
    EASY: [
      "What logging and monitoring tools do you rely on to detect runtime errors in production?",
    ],
    MEDIUM: [
      "How do you approach debugging an intermittent bug in production that cannot be reproduced locally?",
      "What is your procedure for rolling back an unhealthy release while minimizing user disruption?",
    ],
    HARD: [
      "Walk me through how you conduct an engineering incident post-mortem with root-cause analysis and action items.",
    ],
  },
  OPTIMIZATION_AND_SCALE: {
    EASY: [
      "What is the first step you take before attempting to optimize code or system performance?",
    ],
    MEDIUM: [
      "How do you optimize slow database queries and reduce unnecessary network payloads in an application?",
      "What strategies do you use for asset optimization and bundle size reduction in frontend applications?",
    ],
    HARD: [
      "How did you scale a system or API to handle an order of magnitude more traffic without exponentially increasing infrastructure cost?",
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
  if (norm.includes("star") || norm.includes("situation")) return "Behavioral Situation";
  if (norm.includes("culture") || norm.includes("value")) return "Company Culture Alignment";
  if (norm.includes("goal") || norm.includes("career")) return "Career Growth & Goals";
  if (norm.includes("teamwork") || norm.includes("teammate")) return "Team Collaboration";
  if (norm.includes("conflict") || norm.includes("disagree")) return "Conflict Resolution";
  if (norm.includes("leadership") || norm.includes("lead")) return "Leadership & Initiative";
  if (norm.includes("scale") || norm.includes("scaling")) return "System Scalability";
  if (norm.includes("architecture")) return "Architecture & Design";
  if (norm.includes("algorithm") || norm.includes("complexity")) return "Algorithmic Efficiency";
  return topic.replace(/_/g, " ");
}

/**
 * Retrieves a fallback question for a given topic and difficulty level.
 * Guarantees never repeating an already asked question if ANY unasked question exists.
 *
 * @param {string} topic
 * @param {string} difficulty - "EASY" | "MEDIUM" | "HARD" | "ADAPTIVE"
 * @param {string[]} [excludeQuestions=[]] - Questions already asked in this session
 * @param {string} [interviewType="technical"] - Interview type
 * @returns {{ question: string, concept: string, topic: string, difficulty: string, questionType: string, competency: string }}
 */
export const getFallbackQuestion = (
  topic = "TECHNICAL_FUNDAMENTALS",
  difficulty = "EASY",
  excludeQuestions = [],
  interviewType = "technical"
) => {
  const normTopic = String(topic || "TECHNICAL_FUNDAMENTALS").toUpperCase().replace(/\s+/g, "_");
  const normDiff = difficulty === "ADAPTIVE" ? "EASY" : String(difficulty || "EASY").toUpperCase();
  const normInterviewType = String(interviewType || "technical").toLowerCase();

  const isExcluded = (q) => {
    const nq = normalize(q);
    return excludeQuestions.some((asked) => {
      const na = normalize(asked);
      return na === nq || (na && nq && (na.includes(nq) || nq.includes(na)));
    });
  };

  // 1. Check matching topic bank directly
  let topicBank = FALLBACK_QUESTION_BANK[normTopic];

  // 2. If topic bank not found, pick appropriate default bank based on interviewType
  if (!topicBank) {
    if (normInterviewType === INTERVIEW_TYPES.HR) {
      topicBank = FALLBACK_QUESTION_BANK.CULTURE_FIT || FALLBACK_QUESTION_BANK.HR;
    } else if (normInterviewType === INTERVIEW_TYPES.BEHAVIORAL) {
      topicBank = FALLBACK_QUESTION_BANK.BEHAVIORAL || FALLBACK_QUESTION_BANK.LEADERSHIP;
    } else if (normInterviewType === INTERVIEW_TYPES.MANAGERIAL) {
      topicBank = FALLBACK_QUESTION_BANK.TEAM_LEADERSHIP || FALLBACK_QUESTION_BANK.BEHAVIORAL;
    } else if (normInterviewType === INTERVIEW_TYPES.SYSTEM_DESIGN) {
      topicBank = FALLBACK_QUESTION_BANK.SYSTEM_DESIGN || FALLBACK_QUESTION_BANK.HIGH_LEVEL_ARCHITECTURE;
    } else if (normInterviewType === INTERVIEW_TYPES.PROJECT_BASED) {
      topicBank = FALLBACK_QUESTION_BANK.PROJECT_ARCHITECTURE || FALLBACK_QUESTION_BANK.TECHNICAL_CHALLENGES;
    } else if (normInterviewType === INTERVIEW_TYPES.CODING) {
      topicBank = FALLBACK_QUESTION_BANK.PROBLEM_SOLVING || FALLBACK_QUESTION_BANK.DATA_STRUCTURES;
    } else {
      topicBank = FALLBACK_QUESTION_BANK.TECHNICAL_FUNDAMENTALS;
    }
  }

  // Primary difficulty list
  const primaryList = topicBank[normDiff] || topicBank.EASY || [];
  let available = primaryList.filter((q) => !isExcluded(q));

  // 3. If primary difficulty in topic is exhausted, search adjacent difficulties in same topic
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

  // 4. If whole topic is exhausted, search type-appropriate fallback bank
  if (available.length === 0) {
    const typeFallbackBank =
      normInterviewType === INTERVIEW_TYPES.HR
        ? FALLBACK_QUESTION_BANK.HR
        : normInterviewType === INTERVIEW_TYPES.BEHAVIORAL || normInterviewType === INTERVIEW_TYPES.MANAGERIAL
        ? FALLBACK_QUESTION_BANK.BEHAVIORAL
        : normInterviewType === INTERVIEW_TYPES.SYSTEM_DESIGN
        ? FALLBACK_QUESTION_BANK.SYSTEM_DESIGN
        : normInterviewType === INTERVIEW_TYPES.CODING
        ? FALLBACK_QUESTION_BANK.PROBLEM_SOLVING
        : FALLBACK_QUESTION_BANK.TECHNICAL_FUNDAMENTALS;

    for (const d of [normDiff, "EASY", "MEDIUM", "HARD"]) {
      const list = typeFallbackBank[d] || [];
      const unasked = list.filter((q) => !isExcluded(q));
      if (unasked.length > 0) {
        available = unasked;
        break;
      }
    }
  }

  // 5. Ultimate fallback
  const pool = available.length > 0 ? available : (primaryList.length > 0 ? primaryList : ["Can you describe a key project you worked on recently and your primary contributions?"]);
  const selectedQuestion = pool[Math.floor(Math.random() * pool.length)];

  // Resolve appropriate questionType and competency based on topic & interviewType
  const resolvedType = resolveInterviewTypeForTopic(normTopic, [normInterviewType]);
  let questionType = "TECHNICAL";
  let competency = "Technical Knowledge";

  if (resolvedType === INTERVIEW_TYPES.HR) {
    questionType = "HR";
    competency = "Culture & Professionalism";
  } else if (resolvedType === INTERVIEW_TYPES.BEHAVIORAL) {
    questionType = "BEHAVIORAL";
    competency = "Behavioral & Leadership";
  } else if (resolvedType === INTERVIEW_TYPES.MANAGERIAL) {
    questionType = "BEHAVIORAL";
    competency = "People & Project Leadership";
  } else if (resolvedType === INTERVIEW_TYPES.SYSTEM_DESIGN) {
    questionType = "SCENARIO";
    competency = "System Architecture & Scalability";
  } else if (resolvedType === INTERVIEW_TYPES.PROJECT_BASED) {
    questionType = "PROJECT";
    competency = "Project Execution & Architecture";
  } else if (resolvedType === INTERVIEW_TYPES.CODING) {
    questionType = "PROBLEM_SOLVING";
    competency = "Problem Solving & Algorithms";
  }

  return {
    question: selectedQuestion,
    concept: deriveConcept(selectedQuestion, normTopic),
    topic: normTopic,
    difficulty: normDiff,
    questionType,
    competency,
  };
};

export default getFallbackQuestion;
