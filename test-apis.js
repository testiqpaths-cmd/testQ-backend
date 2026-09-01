import axios from 'axios';

const API_URL = 'http://localhost:5000';

// Mock token for testing
const mockToken = 'mock-jwt-token';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Authorization': `Bearer ${mockToken}`,
    'Content-Type': 'application/json'
  }
});

async function testApis() {
  try {
    // Test 1: Get companies
    console.log('\n=== Test 1: GET /companies ===');
    const companiesRes = await api.get('/companies');
    console.log('Status:', companiesRes.status);
    console.log('Response:', JSON.stringify(companiesRes.data, null, 2));
    
    // Test 2: Get questions with company filter
    if (companiesRes.data?.data?.length > 0) {
      const companyId = companiesRes.data.data[0]._id;
      console.log('\n=== Test 2: GET /questions/getAllQuestion with companyIds ===');
      const questionsRes = await api.get('/questions/getAllQuestion', {
        params: {
          companyIds: companyId,
          quantity: 10
        }
      });
      console.log('Status:', questionsRes.status);
      console.log('Found questions:', questionsRes.data?.data?.length || 0);
      console.log('First question:', questionsRes.data?.data?.[0] ? {
        id: questionsRes.data.data[0]._id,
        text: questionsRes.data.data[0].questionText?.substring(0, 50),
        companyIds: questionsRes.data.data[0].companyIds?.map(c => c._id || c)
      } : 'None');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

testApis();
