<?php
// Подключаем автозагрузчик Composer
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

// Загружаем переменные из .env файла (если он есть)
if (file_exists(__DIR__ . '/.env')) {
    $dotenv = Dotenv::createImmutable(__DIR__);
    $dotenv->safeLoad();
}

$webhookUrl = $_ENV['KPRINT_PRICES_WEBHOOK'];
$fileId     = $_ENV['KPRINT_PRICES_FILE_ID'];
$publicUrl  = $_ENV['KPRINT_PRICES_PUBLIC_PAGE'];

// Функция для имитации xlsx.utils.sheet_to_json
function sheetToJson($sheet) {
    $data = $sheet->toArray(null, true, true, false);
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
        throw new Exception('Download failed');
    }

    // PhpSpreadsheet требует физический файл для чтения, поэтому создаем временный
    $tempFile = tempnam(sys_get_temp_dir(), 'kprint_');
    file_put_contents($tempFile, $fileContent);

    $spreadsheet = IOFactory::load($tempFile);

    $baseSheet  = $spreadsheet->getSheetByName('base_prices');
    $printSheet = $spreadsheet->getSheetByName('print_config');
    $techSheet  = $spreadsheet->getSheetByName('tech_reserve');

    if (!$baseSheet || !$printSheet || !$techSheet) {
        throw new Exception('Sheets missing');
    }

    $baseRows  = sheetToJson($baseSheet);
    $printRows = sheetToJson($printSheet);
    $techRows  = sheetToJson($techSheet);

    unlink($tempFile); // Удаляем временный файл

    // Формируем структуру BASE
    $BASE = [
        'with'    => ['white' => [], 'brown' => []],
        'without' => ['white' => [], 'brown' => []]
    ];

    foreach ($baseRows as $r) {
        $handles = preg_match('/без|without/iu', (string)($r['handles'] ?? '')) ? 'without' : 'with';
        $color   = preg_match('/бур|brown/iu', (string)($r['color'] ?? '')) ? 'brown' : 'white';
        $size    = trim(preg_replace('/[×хx]/iu', 'x', (string)($r['size'] ?? '')));
        $price   = (float)($r['unit_price_tg'] ?? 0);
        if ($size) {
            $BASE[$handles][$color][$size] = $price;
        }
    }

    // Формируем структуру PRINT
    $P = [];
    foreach ($printRows as $p) {
        $key = trim((string)($p['key'] ?? ''));
        if ($key) {
            $P[$key] = (float)($p['value_tg'] ?? 0);
        }
    }

    $PRINT = [
        'makeready_per_side_tg' => $P['makeready_per_side_tg'] ?? 7000,
        'rates' => [
            'bw'    => [1 => $P['bw_one_side_tg'] ?? 20,  2 => $P['bw_two_sides_tg'] ?? 35],
            'color' => [1 => $P['color_one_side_tg'] ?? 40, 2 => $P['color_two_sides_tg'] ?? 70]
        ]
    ];

    // Формируем структуру TECH_RESERVE
    $TECH = [];
    foreach ($techRows as $t) {
        $TECH[] = [
            'from'  => (float)($t['qty_from'] ?? 0),
            'to'    => (float)($t['qty_to'] ?? 0),
            'value' => (float)($t['tech_reserve_tg'] ?? 0)
        ];
    }
    usort($TECH, function($a, $b) { return $a['from'] <=> $b['from']; });

    echo json_encode([
        'base' => $BASE,
        'print' => $PRINT,
        'tech_reserve' => $TECH
    ], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    http_response_code(502);
    echo json_encode(['error' => 'price_source_unavailable', 'msg' => $e->getMessage()]);
}