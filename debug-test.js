import mongoose from "mongoose";
import "dotenv/config.js";

// Models
const questionSchema = new mongoose.Schema({
  subjectId: mongoose.Schema.Types.ObjectId,
  topicId: mongoose.Schema.Types.ObjectId,
  questionText: String,
  type: String,
  options: [String],
  correctAnswer: String,
  marks: Number,
  difficulty: String,
  createdBy: mongoose.Schema.Types.ObjectId,
  excelBatchId: { type: String, index: true },
  isActive: Boolean,
  createdAt: Date,
});

const testSchema = new mongoose.Schema({
  title: String,
  questionSource: String,
  excelBatchId: String,
  totalQuestions: Number,
  subjectIds: [mongoose.Schema.Types.ObjectId],
  topicIds: [mongoose.Schema.Types.ObjectId],
  difficulty: [String],
  type: [String],
});

const Question = mongoose.model("Question", questionSchema);
const Test = mongoose.model("Test", testSchema);

const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/testportal";

async function debugTest() {
  try {
    console.log(`\n🔗 Connecting to MongoDB: ${mongoUri}`);
    await mongoose.connect(mongoUri);
    console.log("✅ Connected\n");

    const testId = "69ee13e56d1b60b76e38ff02";
    const excelBatchId = "c6b4a78d-97c5-47de-8f30-177053d7b1d0";

    // 1. Get the test document
    console.log(`📋 Fetching test: ${testId}`);
    const test = await Test.findById(testId).lean();
    
    if (!test) {
      console.log("❌ Test not found\n");
      process.exit(1);
    }

    console.log("\n📄 TEST DOCUMENT:");
    console.log("─".repeat(80));
    console.log(JSON.stringify(test, null, 2));
    console.log("─".repeat(80));

    // 2. Count total questions
    console.log("\n📊 QUESTION COUNTS:");
    const totalQuestions = await Question.countDocuments();
    console.log(`   Total questions in DB: ${totalQuestions}`);

    // 3. Count questions with this excelBatchId
    const excelBatchQuestions = await Question.countDocuments({ excelBatchId });
    console.log(`   Questions with excelBatchId '${excelBatchId}': ${excelBatchQuestions}`);

    // 4. Sample questions from this batch
    if (excelBatchQuestions > 0) {
      console.log(`\n📝 Sample questions from this batch:`);
      const samples = await Question.find({ excelBatchId }).limit(3).lean();
      samples.forEach((q, i) => {
        console.log(`\n   [${i + 1}] ID: ${q._id}`);
        console.log(`       Text: ${q.questionText?.substring(0, 80)}...`);
        console.log(`       Type: ${q.type}, Difficulty: ${q.difficulty}, Marks: ${q.marks}`);
        console.log(`       ExcelBatchId: ${q.excelBatchId}`);
      });
    }

    // 5. Apply the exact filters from buildFilters
    console.log("\n🔍 FILTER APPLIED BY selectAttemptQuestions:");
    const filters = {};
    if (test.excelBatchId) {
      filters.excelBatchId = test.excelBatchId;
      console.log(`   excelBatchId: "${filters.excelBatchId}"`);
    }
    if (test.subjectIds?.length) {
      filters.subjectId = { $in: test.subjectIds };
      console.log(`   subjectId: { $in: ${JSON.stringify(test.subjectIds)} }`);
    }
    if (test.topicIds?.length) {
      filters.topicId = { $in: test.topicIds };
      console.log(`   topicId: { $in: ${JSON.stringify(test.topicIds)} }`);
    }
    if (test.type?.length) {
      filters.type = { $in: test.type };
      console.log(`   type: { $in: ${JSON.stringify(test.type)} }`);
    }
    if (test.difficulty?.length) {
      filters.difficulty = { $in: test.difficulty };
      console.log(`   difficulty: { $in: ${JSON.stringify(test.difficulty)} }`);
    }

    // 6. Count matching questions
    const matchingQuestions = await Question.countDocuments(filters);
    console.log(`\n   Questions matching filters: ${matchingQuestions}`);

    // 7. If no matches, debug why
    if (matchingQuestions === 0 && excelBatchQuestions > 0) {
      console.log("\n⚠️  ISSUE: Excel batch has questions, but filters returned 0");
      console.log("   Checking each filter individually:");
      
      const questionSample = await Question.findOne({ excelBatchId }).lean();
      if (questionSample) {
        console.log(`\n   Sample question from batch:`);
        console.log(`   - excelBatchId: ${questionSample.excelBatchId}`);
        console.log(`   - difficulty: ${questionSample.difficulty}`);
        console.log(`   - type: ${questionSample.type}`);
        console.log(`   - subjectId: ${questionSample.subjectId}`);
        console.log(`   - topicId: ${questionSample.topicId}`);

        if (test.subjectIds?.length) {
          const hasSubject = test.subjectIds.some(sid => String(sid) === String(questionSample.subjectId));
          console.log(`\n   Does test.subjectIds include question.subjectId? ${hasSubject}`);
          console.log(`   Test subjectIds: ${test.subjectIds.map(s => String(s)).join(", ")}`);
          console.log(`   Question subjectId: ${questionSample.subjectId}`);
        }

        if (test.difficulty?.length) {
          const hasDifficulty = test.difficulty.includes(questionSample.difficulty);
          console.log(`\n   Does test.difficulty include question.difficulty? ${hasDifficulty}`);
          console.log(`   Test difficulty: ${test.difficulty.join(", ")}`);
          console.log(`   Question difficulty: ${questionSample.difficulty}`);
        }
      }
    }

    console.log("\n" + "═".repeat(80));
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

debugTest();
