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

// Загружаем переменные (используем имена из вашего .env)
$webhookUrl = $_ENV['KPRINT_SQUARE_10KPLUS_WEBHOOK'] ?? '';
$fileId     = $_ENV['KPRINT_SQUARE_10KPLUS_FILE_ID'] ?? '';
$publicUrl  = $_ENV['KPRINT_SQUARE_10KPLUS_PUBLIC_PAGE'] ?? '';

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
        throw new Exception('Download failed Q10000');
    }

    $tempFile = tempnam(sys_get_temp_dir(), 'kprint_q10k_');
    file_put_contents($tempFile, $fileContent);

    $spreadsheet = IOFactory::load($tempFile);
    unlink($tempFile);

    // Функция-помощник для получения данных с листа (с выбросом ошибки, если листа нет)
    $getSheet = function($name) use ($spreadsheet) {
        $sheet = $spreadsheet->getSheetByName($name);
        if (!$sheet) throw new Exception('Sheet missing: ' . $name);
        return sheetToJson($sheet);
    };

    $CONFIG = $getSheet('CONFIG');
    $MATERIALS = $getSheet('MATERIALS');
    $ROLL_WIDTHS = $getSheet('ROLL_WIDTHS');
    $RAPPORTS = $getSheet('RAPPORTS');
    $WIDTH_OPTIONS = $getSheet('WIDTH_OPTIONS');
    $RECOMMENDED = $getSheet('RECOMMENDED');
    $COLOR_MAKE_READY = $getSheet('COLOR_MAKE_READY');
    $TECH_RESERVE = $getSheet('TECH_RESERVE');
    $MARGIN = $getSheet('MARGIN');
    $FORMING_SETUP_RULES = $getSheet('FORMING_SETUP_RULES');
    $FORMING_RATE_BY_WIDTH = $getSheet('FORMING_RATE_BY_WIDTH');
    $HANDLES_PRICE = $getSheet('HANDLES_PRICE');

    $payload = [
            'config' => $CONFIG,
            'materials' => $MATERIALS,
            'roll_widths' => array_map(function($r) { return (float)($r['roll_width_mm'] ?? 0); }, $ROLL_WIDTHS),
            'rapports' => array_map(function($r) { return (float)($r['rapport_mm'] ?? 0); }, $RAPPORTS),
            'width_options' => array_map(function($r) { return (float)($r['width_mm'] ?? 0); }, $WIDTH_OPTIONS),
            'recommended' => $RECOMMENDED,
            'color_make_ready' => $COLOR_MAKE_READY,
            'tech_reserve' => $TECH_RESERVE,
            'margin' => $MARGIN,
            'forming_setup_rules' => $FORMING_SETUP_RULES[0] ?? null,
            'forming_rate_by_width' => $FORMING_RATE_BY_WIDTH,
            'handles_price' => $HANDLES_PRICE
    ];

    echo json_encode($payload, JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    http_response_code(502);
    echo json_encode(['error' => 'q10000_price_source_unavailable', 'msg' => $e->getMessage()]);
}