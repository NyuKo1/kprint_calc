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

// <-- 2. ДОБАВЛЕНА ЗАГРУЗКА ФАЙЛА .env -->
if (file_exists(__DIR__ . '/.env')) {
    $dotenv = Dotenv::createImmutable(__DIR__);
    $dotenv->safeLoad();
}

// ================== НАСТРОЙКИ ==================
// Теперь $_ENV будет успешно заполнен данными из вашего .env
$webhookUrl = $_ENV['KPRINT_TECHCARD_WEBHOOK'];
$fileId     = $_ENV['KPRINT_TECHCARD_FILE_ID'];
$sheetName  = $_ENV['KPRINT_TECHCARD_SHEET_NAME'];
// ===============================================================

// Получаем номер техкарты из GET-запроса (?id=1234)
$requestedId = $_GET['id'] ?? null;
if (!$requestedId) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Не указан номер техкарты (?id=...)']);
    exit;
}

// Функция скачивания файла через вебхук
function downloadViaWebhook($wh, $id) {
    $url = rtrim($wh, '/') . '/disk.file.get.json?id=' . $id;

    // 1. Получаем ссылку на скачивание через cURL
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // Игнорируем ошибки SSL сертификатов хостинга
    $json = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || !$json) {
        throw new Exception("Ошибка запроса к API. HTTP Код: $httpCode. Ответ: $json");
    }

    $data = json_decode($json, true);

    // Проверяем, не вернул ли сам Битрикс ошибку прав доступа
    if (isset($data['error'])) {
        throw new Exception("Битрикс ругается: " . ($data['error_description'] ?? $data['error']));
    }

    $downloadUrl = $data['result']['DOWNLOAD_URL'] ?? null;
    if (!$downloadUrl) {
        throw new Exception("Битрикс не дал ссылку DOWNLOAD_URL. Вот что он ответил: " . substr($json, 0, 300));
    }

    // 2. Скачиваем сам файл
    $ch2 = curl_init();
    curl_setopt($ch2, CURLOPT_URL, $downloadUrl);
    curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch2, CURLOPT_FOLLOWLOCATION, true); // Важно! Разрешаем идти по редиректам
    curl_setopt($ch2, CURLOPT_SSL_VERIFYPEER, false);
    $fileContent = curl_exec($ch2);
    $downloadError = curl_error($ch2);
    curl_close($ch2);

    if (!$fileContent) {
        throw new Exception("Не удалось скачать сам файл. Ошибка cURL: $downloadError");
    }

    return $fileContent;
}

try {
    // 1. Скачиваем файл журнала
    $fileContent = downloadViaWebhook($webhookUrl, $fileId);
    if (!$fileContent) {
        throw new Exception('Не удалось скачать файл журнала из Bitrix24');
    }

    // 2. Создаем временный файл для PhpSpreadsheet
    $tempFile = tempnam(sys_get_temp_dir(), 'journal_');
    file_put_contents($tempFile, $fileContent);

    // 3. Загружаем таблицу
    $spreadsheet = IOFactory::load($tempFile);
    $sheet = $spreadsheet->getSheetByName($sheetName);

    if (!$sheet) {
        throw new Exception("Лист '{$sheetName}' не найден в журнале");
    }

    // Получаем все данные в виде массива (индексы с 0)
    $data = $sheet->toArray(null, true, true, false);
    unlink($tempFile); // Удаляем временный файл, он больше не нужен

    // 4. Ищем строку с нужным номером техкарты (Колонка A = индекс 0)
    $foundRow = null;
    foreach ($data as $row) {
        if (trim((string)$row[0]) === trim((string)$requestedId)) {
            $foundRow = $row;
            break;
        }
    }

    if (!$foundRow) {
        throw new Exception("Техкарта с номером {$requestedId} не найдена в журнале");
    }

    // 5. Собираем ответ, опираясь на номера колонок из вашего VBA (индекс массива = Колонка - 1)
    $response = [
        'OrderNumber'   => $foundRow[0] ?? '',
        'Date'          => $foundRow[1] ?? '',
        'Customer'      => $foundRow[2] ?? '',
        'ProductName'   => $foundRow[3] ?? '',
        'Circulation'   => $foundRow[4] ?? '',
        'Manager'       => $foundRow[5] ?? '',
        'OrderType'     => $foundRow[6] ?? '',

        'Shape'         => $foundRow[7] ?? '',
        'Width'         => $foundRow[8] ?? '',
        'Depth'         => $foundRow[9] ?? '',
        'Height'        => $foundRow[10] ?? '',

        'AmountInWidth' => $foundRow[11] ?? '',
        'PaperType'     => $foundRow[12] ?? '',
        'Density'       => $foundRow[13] ?? '',

        'HasHandles'    => $foundRow[14] ?? '',
        'ColorCount'    => $foundRow[15] ?? '',
        'Cliche'        => $foundRow[16] ?? '',
        'PackageColor'  => $foundRow[17] ?? '',
        'ColorApproval' => $foundRow[18] ?? '',
        'PrintType'     => $foundRow[19] ?? '',

        'HandleColor'   => $foundRow[21] ?? '',
        'WindowWidth'   => $foundRow[22] ?? '',
        'WindowHeight'  => $foundRow[23] ?? ''
    ];

    // Отправляем успешный ответ
    echo json_encode([
        'status' => 'success',
        'data' => $response
    ], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage()
    ], JSON_UNESCAPED_UNICODE);
}