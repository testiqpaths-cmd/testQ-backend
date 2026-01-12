export class ApiResponse {
  constructor(statusCode, data, message = 'Success') {
    this.success = true;
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
  }
}
