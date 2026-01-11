import app from './app.js';
import {env} from './config/index.js'

const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
