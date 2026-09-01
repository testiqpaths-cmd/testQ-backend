import { connectDB } from './src/config/db.js';
import Question from './src/models/question.model.js';
import Subject from './src/models/subject.model.js';
import User from './src/models/user.model.js';

async function createSampleData() {
  await connectDB();
  
  // Get any existing user to use as createdBy
  let user = await User.findOne();
  if (!user) {
    console.error('No users found in database. Please create a user first.');
    process.exit(1);
  }
  
  // Get first subject or create one
  let subject = await Subject.findOne({ isActive: true });
  if (!subject) {
    subject = new Subject({
      name: 'Physics Test ' + Date.now(),
      description: 'Physics',
      createdBy: user._id
    });
    await subject.save();
  }
  
  const companyId = '6a9694ffa79ed7497b115fe4';
  
  // Create sample questions
  const questions = [];
  for (let i = 1; i <= 3; i++) {
    const q = new Question({
      questionText: `Sample Question ${i} for Test Company`,
      description: `This is a sample question ${i}`,
      subjectId: subject._id,
      type: 'MCQ',
      difficulty: i === 1 ? 'EASY' : i === 2 ? 'MEDIUM' : 'HARD',
      marks: 1,
      companyIds: [companyId],
      createdBy: user._id,
      isActive: true
    });
    await q.save();
    questions.push(q._id);
  }
  
  console.log('Created 3 sample questions:');
  console.log('Company ID:', companyId);
  console.log('Subject ID:', subject._id);
  console.log('Question IDs:', questions);
  process.exit(0);
}

createSampleData().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
