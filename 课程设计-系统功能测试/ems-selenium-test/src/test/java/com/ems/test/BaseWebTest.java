package com.ems.test;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;

/**
 * 公共 WebDriver 与管理员登录辅助。
 */
public abstract class BaseWebTest {

    protected static final String BASE =
            System.getProperty("ems.base.url", "http://localhost:8080");

    protected WebDriver driver;
    protected WebDriverWait wait;

    @BeforeEach
    void openBrowser() {
        driver = new ChromeDriver();
        driver.manage().window().maximize();
        wait = new WebDriverWait(driver, Duration.ofSeconds(12));
    }

    @AfterEach
    void closeBrowser() {
        if (driver != null) {
            driver.quit();
        }
    }

    protected void loginAsAdmin() {
        driver.get(BASE + "/login.html");
        driver.findElement(By.id("username")).sendKeys("root");
        driver.findElement(By.id("password")).sendKeys("123456");
        driver.findElement(By.cssSelector(".login-btn")).click();
        wait.until(ExpectedConditions.urlContains("index.html"));
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("currentUser")));
    }

    protected void openPanel(String panel) {
        driver.findElement(By.cssSelector(".nav-item[data-panel='" + panel + "']")).click();
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("panel-" + panel)));
    }
}
