syntax = "proto3";

//import "google/protobuf/any.proto"; // google.protobuf.Any
//import "google/protobuf/empty.proto"; // google.protobuf.Empty

// inspired by https://github.com/google/protobuf/blob/master/src/google/protobuf/empty.proto
message Empty {}

// inspired by https://github.com/google/protobuf/blob/master/src/google/protobuf/any.proto
message Any {
  string type = 1;
  bytes value = 2;
}
