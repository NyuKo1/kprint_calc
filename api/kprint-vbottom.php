<?php
require 'vendor/autoload.php';

use PhpOffice\PhpSpreadsheet\IOFactory;
use Dotenv\Dotenv;

// Настройки CORS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json; charset=utf-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (file_exists(__DIR__ . '/.env')) {
    $dotenv = Dotenv::createImmutable(__DIR__);
    $dotenv->safeLoad();
}

$webhookUrl = $_ENV['KPRINT_VBOTTOM_WEBHOOK'] ?? '';
$fileId     = $_ENV['KPRINT_VBOTTOM_FILE_ID'] ?? '';
$publicUrl  = $_ENV['KPRINT_VBOTTOM_PUBLIC_PAGE'] ?? '';

function sheetToJson($sheet) {
    if (!$sheet) return [];
    $data = $sheet->toArray(null, true, true, false);
    if (empty($data)) return [];
    $headers = array_shift($data);
    $result = [];
    foreach ($data as $row) {
        $rowAssoc = [];
        $isEmpty = true;
        foreach ($headers as $index => $key) {
            if ($key) {
                $val = $row[$index];
                $rowAssoc[$key] = $val;
                if ($val !== null && $val !== '') $isEmpty = false;
            }
        }
        if (!$isEmpty) $result[] = $rowAssoc;
    }
    return $result;
}

function downloadViaWebhook($wh, $id) {
    if (!$wh || !$id) return false;
    $url = rtrim($wh, '/') . '/disk.file.get.json?id=' . $id;
    $context = stream_context_create(['http' => ['ignore_errors' => true]]);
    $json = @file_get_contents($url, false, $context);
    if (!$json) return false;
    $data = json_decode($json, true);
    $downloadUrl = $data['result']['DOWNLOAD_URL'] ?? null;
    if (!$downloadUrl) return false;
    return @file_get_contents($downloadUrl);
}

function smartDownload($url) {
    if (!$url) return false;
    $content = @file_get_contents($url);
    if (strpos(substr($content, 0, 4), "PK\x03\x04") === 0) return $content;

    $guessUrl = $url . (strpos($url, '?') !== false ? '&' : '?') . 'download=1&ncc=1';
    $content = @file_get_contents($guessUrl);
    if (strpos(substr($content, 0, 4), "PK\x03\x04") === 0) return $content;

    return false;
}

try {
    $fileContent = downloadViaWebhook($webhookUrl, $fileId);
    if (!$fileContent) {
        $fileContent = smartDownload($publicUrl);
    }
    if (!$fileContent) {
        throw new Exception('Download failed V-Bottom');
    }

    $tempFile = tempnam(sys_get_temp_dir(), 'kprint_vb_');
    file_put_contents($tempFile, $fileContent);

    $spreadsheet = IOFactory::load($tempFile);
    unlink($tempFile);

    $payload = [];
    // Динамически перебираем все листы в книге
    foreach ($spreadsheet->getSheetNames() as $sheetName) {
        $sheet = $spreadsheet->getSheetByName($sheetName);
        $payload[$sheetName] = sheetToJson($sheet);
    }

    echo json_encode($payload, JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    http_response_code(502);
    echo json_encode(['error' => 'vbottom_price_source_unavailable', 'msg' => $e->getMessage()]);
}