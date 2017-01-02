service Invocations {
  // inspired by https://github.com/googleapis/googleapis/blob/master/google/longrunning/operations.proto
  rpc ListInvocations(ListInvocationsRequest) returns (ListInvocationsResponse) {}
  rpc GetInvocation(GetInvocationRequest) returns (Invocation) {}
  rpc CancelInvocation(CancelInvocationRequest) returns (Empty) {}
  rpc DeleteInvocation(DeleteInvocationRequest) returns (Empty) {}

  // proactively pull result (using tail -F)
  rpc GetResult(GetResultRequest) returns (GetResultResponse) {}
  // proactively pull result; stream remains open until result is complete
  rpc StreamResults(StreamResultsRequest) returns (stream StreamResultsResponse) {}
}

message Status {
  int32 code = 1;
  string message = 2;
  repeated Any details = 3;
}

message Invocation {
  string id = 1;
  bool done = 2;
  oneof outcome {
    Status error = 3;
    Any results = 4;
  }
}

message GetInvocationRequest {
  string id = 1;
  repeated string exclude_results = 2;
}

message ListInvocationsRequest {
  string filter = 1;
  repeated string exclude_results = 2;
}

message ListInvocationsResponse {
  repeated Invocation invocations = 1;
}

message CancelInvocationRequest {
  string id = 1;
}

message DeleteInvocationRequest {
  string id = 1;
}

message GetResultRequest {
  string id = 1;
  string name = 2;
}

message GetResultResponse {
  Any value = 1;
}

message StreamResultsRequest {
  string id = 1;
  string name = 2;
}

// just include final results if no out stream or invocation done
message StreamResultsResponse {
  Any results = 1; // [OperationName]Results message
}
