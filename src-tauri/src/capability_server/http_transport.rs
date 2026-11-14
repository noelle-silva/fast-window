use std::net::TcpStream;

use super::{capability_service::CapabilityService, CapabilityHttpResponse};
use crate::local_http;

const CONTROL_TOKEN_HEADER: &str = "x-fw-control-token";

pub(super) fn handle_connection(
    mut stream: TcpStream,
    expected_token: &str,
    service: &CapabilityService,
) {
    let request = match local_http::read_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            write_response(&mut stream, CapabilityHttpResponse::error(400, error));
            return;
        }
    };

    if request.header(CONTROL_TOKEN_HEADER).unwrap_or_default() != expected_token {
        write_response(
            &mut stream,
            CapabilityHttpResponse::error(401, "控制令牌无效"),
        );
        return;
    }

    let response = service.handle_request(&request.method, &request.path, &request.body);
    write_response(&mut stream, response);
}

fn write_response(stream: &mut TcpStream, response: CapabilityHttpResponse) {
    local_http::write_json(stream, response.status, &response.body);
}
