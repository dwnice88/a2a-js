import { handleApproverPost } from "../approver-handler";

export async function POST(request: Request) {
  return handleApproverPost("manager", request);
}
