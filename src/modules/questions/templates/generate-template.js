import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate the question template Excel file
 */
export const generateQuestionTemplate = async () => {
  try {
    const templatePath = path.join(__dirname, 'question_template.xlsx');

    // Delete existing template to regenerate with latest structure
    if (fs.existsSync(templatePath)) {
      fs.unlinkSync(templatePath);
    }

    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Questions');

    // Define headers based on schema
    const headers = [
      'subject',
      'topic',
      'questionText',
      'type',
      'options',
      'correctAnswer',
      'difficulty'
    ];

    // Add headers
    worksheet.addRow(headers);

    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };

    // Set column widths
    worksheet.columns = [
      { width: 20 },  // subject
      { width: 20 },  // topic
      { width: 40 },  // questionText
      { width: 15 },  // type (MCQ, TRUE_FALSE, SHORT, LONG)
      { width: 25 },  // options (pipe-separated)
      { width: 15 },  // correctAnswer
      { width: 15 }   // difficulty
    ];

    // Add sample rows with different question types
    const sampleQuestions = [
      ['Mathematics', 'Algebra', 'What is 2 + 2?', 'MCQ', '1|2|3|4', '4', 'EASY'],
      ['Science', 'Physics', 'The earth revolves around the sun', 'TRUE_FALSE', 'TRUE|FALSE', 'TRUE', 'MEDIUM'],
      ['Mathematics', 'Arithmetic', 'What is the sum of 5 + 6 + 7 + 8?', 'MCQ', '25|26|27|28', '26', 'EASY'],
      ['Science', 'Chemistry', 'Water boils at 100 degrees Celsius', 'TRUE_FALSE', 'TRUE|FALSE', 'TRUE', 'EASY'],
      ['English', 'Vocabulary', 'Synonym of Happy', 'MCQ', 'Sad|Joyful|Angry|Depressed', 'Joyful', 'EASY'],
      ['Mathematics', 'Geometry', 'Number of sides in a square', 'MCQ', '2|3|4|5', '4', 'EASY'],
      ['Science', 'Biology', 'Humans breathe oxygen', 'TRUE_FALSE', 'TRUE|FALSE', 'TRUE', 'EASY']
    ];

    sampleQuestions.forEach(question => {
      const row = worksheet.addRow(question);
      row.font = { italic: true, color: { argb: 'FF808080' } };
    });

    // Add instructions sheet
    const instructionsSheet = workbook.addWorksheet('Instructions');
    
    const instructions = [
      ['Question Upload Template Instructions'],
      [],
      ['Column Details:'],
      ['subject', 'The subject name (e.g., Mathematics, Science, English)'],
      ['topic', 'The topic name (e.g., Algebra, Physics, Grammar)'],
      ['questionText', 'The actual question content'],
      ['type', 'MCQ, TRUE_FALSE'],
      ['options', 'Pipe-separated options (e.g., "1|2|3|4" or "TRUE|FALSE").'],
      ['correctAnswer', 'The correct answer value (e.g., "4" for MCQ, "TRUE" for TRUE_FALSE)'],
      ['difficulty', 'EASY, MEDIUM, or HARD'],
      [],
      ['Important Notes:'],
      ['- All fields are required'],
      ['- questionText must not be empty'],
      ['- options should be pipe-separated (|) with no spaces'],
      ['- correctAnswer must match one of the provided options exactly'],
      ['- For TRUE_FALSE type, use "TRUE" or "FALSE" in options'],
      ['- For SHORT/LONG types, leave options empty and put the expected answer in correctAnswer'],
      ['- difficulty should be EASY, MEDIUM, or HARD']
    ];

    instructions.forEach((row, index) => {
      const excelRow = instructionsSheet.addRow(row);
      if (index === 0) {
        excelRow.font = { bold: true, size: 14 };
      } else if (row[0] === 'Important Notes:' || row[0] === 'Column Details:') {
        excelRow.font = { bold: true, size: 12 };
      }
    });

    instructionsSheet.columns = [
      { width: 20 },
      { width: 50 }
    ];

    // Save workbook
    await workbook.xlsx.writeFile(templatePath);
    console.log('Question template generated successfully at:', templatePath);
    
    return templatePath;
  } catch (error) {
    console.error('Error generating template:', error);
    throw error;
  }
};

// Generate template if this file is run directly
const args = process.argv.slice(2);
if (args[0] === '--generate' || process.argv[1] === fileURLToPath(import.meta.url)) {
  generateQuestionTemplate().catch(err => {
    console.error('Failed to generate template:', err);
    process.exit(1);
  });
}
